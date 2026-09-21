//! Platform-agnostic Bridge: the only surface the AI talks to.
//!
//! A *plane* here is a WebSocket-connected page. Each connection is represented
//! by a [`PlaneHandle`] that sends JSON requests and awaits JSON responses.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, RwLock};

use crate::ticket::random_token;

pub type ToolResult = Result<Value, String>;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub struct PlaneHandle {
    pub id: String,
    pub kind: String,
    out_tx: mpsc::UnboundedSender<Value>,
    pending: Mutex<HashMap<String, oneshot::Sender<ToolResult>>>,
    closed: AtomicBool,
}

impl PlaneHandle {
    pub fn new(id: String, kind: String, out_tx: mpsc::UnboundedSender<Value>) -> Self {
        Self {
            id,
            kind,
            out_tx,
            pending: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
        }
    }

    /// Send one request to the page and wait for its matching response.
    pub async fn call(&self, method: &str, mut extra: Value) -> ToolResult {
        if self.closed.load(Ordering::SeqCst) {
            return Err("plane disconnected".to_string());
        }

        let id = format!(
            "{}:{}",
            self.id,
            random_token().chars().take(8).collect::<String>()
        );
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);

        if let Value::Object(ref mut map) = extra {
            map.insert("id".to_string(), Value::String(id.clone()));
            map.insert("type".to_string(), Value::String(method.to_string()));
        } else {
            extra = json!({ "id": id, "type": method });
        }

        if self.out_tx.send(extra).is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err("plane disconnected".to_string());
        }

        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("plane disconnected".to_string()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("bridge request timed out: {method}"))
            }
        }
    }

    /// Route a response message from the page (`{ id, result }` or `{ id, error }`).
    pub fn route_response(&self, message: Value) {
        let Some(id) = message.get("id").and_then(Value::as_str) else {
            return;
        };
        let Some(tx) = self.pending.lock().unwrap().remove(id) else {
            return;
        };
        let result = if let Some(error) = message.get("error") {
            Err(error
                .as_str()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| error.to_string()))
        } else {
            Ok(message.get("result").cloned().unwrap_or(Value::Null))
        };
        let _ = tx.send(result);
    }

    pub fn close(&self, reason: &str) {
        self.closed.store(true, Ordering::SeqCst);
        let mut pending = self.pending.lock().unwrap();
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(reason.to_string()));
        }
    }
}

pub struct Bridge {
    planes: RwLock<HashMap<String, Arc<PlaneHandle>>>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self::new()
    }
}

impl Bridge {
    pub fn new() -> Self {
        Self {
            planes: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register(&self, plane: Arc<PlaneHandle>) {
        self.planes.write().await.insert(plane.id.clone(), plane);
    }

    pub async fn unregister(&self, id: &str) {
        self.planes.write().await.remove(id);
    }

    pub async fn target_count(&self) -> usize {
        self.planes.read().await.len()
    }

    pub async fn resolve(&self) -> Option<Arc<PlaneHandle>> {
        self.planes.read().await.values().next().cloned()
    }

    /// Dispatch the five fixed tools. No arbitrary JS is ever executed here.
    pub async fn call_tool(&self, name: &str, args: &Value) -> ToolResult {
        let target = self.resolve().await;
        let Some(target) = target else {
            return Ok(match name {
                "map" => json!({ "pages": [] }),
                "routine" => json!({ "edges": [] }),
                "snapshot" => json!({ "focused": null, "page": null }),
                "act" => json!({ "ok": false, "error": "no target" }),
                "wait_for_ui" => json!({ "ready": false, "reason": "no target" }),
                _ => return Err(format!("unknown tool: {name}")),
            });
        };

        match name {
            "map" => target.call("map", json!({})).await,
            "routine" => {
                let mut extra = json!({});
                if let Some(node) = args.get("node") {
                    extra["node"] = node.clone();
                }
                target.call("routine", extra).await
            }
            "snapshot" => target.call("snapshot", json!({})).await,
            "act" => {
                let action_id = args
                    .get("actionId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "missing actionId".to_string())?;
                let mut extra = json!({ "actionId": action_id });
                if let Some(value) = args.get("value") {
                    extra["value"] = value.clone();
                }
                target.call("act", extra).await
            }
            "wait_for_ui" => {
                let mut extra = json!({});
                if let Some(timeout) = args.get("timeoutMs") {
                    extra["timeoutMs"] = timeout.clone();
                }
                target.call("wait", extra).await
            }
            _ => Err(format!("unknown tool: {name}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn empty_bridge_returns_safe_tool_defaults() {
        let bridge = Bridge::new();
        assert_eq!(
            bridge.call_tool("map", &json!({})).await.unwrap(),
            json!({ "pages": [] })
        );
        assert_eq!(
            bridge.call_tool("snapshot", &json!({})).await.unwrap(),
            json!({ "focused": null, "page": null })
        );
        assert_eq!(
            bridge
                .call_tool("act", &json!({ "actionId": "a1" }))
                .await
                .unwrap(),
            json!({ "ok": false, "error": "no target" })
        );
    }

    #[tokio::test]
    async fn plane_round_trips_through_channel() {
        let (out_tx, mut out_rx) = mpsc::unbounded_channel();
        let plane = Arc::new(PlaneHandle::new("web:test".into(), "web".into(), out_tx));

        let responder = {
            let plane = plane.clone();
            tokio::spawn(async move {
                let request = out_rx.recv().await.unwrap();
                let id = request.get("id").unwrap().as_str().unwrap().to_string();
                plane.route_response(json!({ "id": id, "result": { "pages": [] } }));
            })
        };

        let result = plane.call("map", json!({})).await.unwrap();
        responder.await.unwrap();
        assert_eq!(result, json!({ "pages": [] }));
    }
}
