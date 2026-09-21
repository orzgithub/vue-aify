//! Minimal Model Context Protocol server over stdio (newline-delimited JSON-RPC).
//!
//! The five tools are fixed; this module only translates MCP calls into Bridge
//! calls and formats the result as MCP content.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::bridge::Bridge;

const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

pub async fn run_stdio(bridge: Arc<Bridge>) -> anyhow::Result<()> {
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    while let Some(line) = lines.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let request: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(err) => {
                eprintln!("[mcp] invalid JSON-RPC message: {err}");
                continue;
            }
        };

        if let Some(response) = handle_message(&bridge, request).await {
            let mut encoded = serde_json::to_vec(&response)?;
            encoded.push(b'\n');
            stdout.write_all(&encoded).await?;
            stdout.flush().await?;
        }
    }

    Ok(())
}

pub async fn handle_message(bridge: &Bridge, request: Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    let response = match method {
        "notifications/initialized" | "notifications/cancelled" => return None,
        "initialize" => {
            let protocol_version = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_PROTOCOL_VERSION)
                .to_string();
            success(
                id,
                json!({
                    "protocolVersion": protocol_version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "aify-mcp", "version": env!("CARGO_PKG_VERSION") }
                }),
            )
        }
        "ping" => success(id, json!({})),
        "tools/list" => success(id, json!({ "tools": tool_specs() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            match bridge.call_tool(name, &arguments).await {
                Ok(result) => success(id, tool_content(normalize_tool_result(name, result), false)),
                Err(err) => success(id, tool_content(json!({ "error": err }), true)),
            }
        }
        _ => error(id, -32601, format!("Method not found: {method}")),
    };

    Some(response)
}

fn success(id: Option<Value>, result: Value) -> Value {
    match id {
        Some(id) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        None => json!({ "jsonrpc": "2.0", "result": result }),
    }
}

fn error(id: Option<Value>, code: i64, message: String) -> Value {
    match id {
        Some(id) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
        None => json!({ "jsonrpc": "2.0", "error": { "code": code, "message": message } }),
    }
}

/// MCP `structuredContent` must be a JSON object/record. The page transport
/// returns arrays for `map` and `routine`, so wrap them in the same envelopes
/// used by the bridge tool schemas.
fn normalize_tool_result(tool: &str, result: Value) -> Value {
    match (tool, result) {
        ("map", Value::Array(pages)) => json!({ "pages": pages }),
        ("routine", Value::Array(edges)) => json!({ "edges": edges }),
        (_, Value::Array(items)) => json!({ "items": items }),
        (_, other) => other,
    }
}

fn tool_content(result: Value, is_error: bool) -> Value {
    let text = serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string());
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": result,
        "isError": is_error
    })
}

fn tool_specs() -> Value {
    json!([
        {
            "name": "map",
            "description": "List all pages that currently EXIST. Each has focused/ready flags.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "routine",
            "description": "List page->page transition edges (from, to, via action id). Pass node to scope to one page (its in/out edges) or one action id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "node": { "type": "string", "description": "page id or action id to scope to" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "snapshot",
            "description": "Get the action/module tree of the CURRENTLY FOCUSED page only. (Single-window rule.)",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "act",
            "description": "Trigger a fixed, pre-registered action by id. Only that action runs; no arbitrary code. Requires value for input actions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "actionId": { "type": "string", "description": "action id from snapshot" },
                    "value": { "type": "string", "description": "value for input actions" }
                },
                "required": ["actionId"],
                "additionalProperties": false
            }
        },
        {
            "name": "wait_for_ui",
            "description": "Wait ONLY for the focused page to finish loading (its ready flag). Never waits for individual elements.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "timeoutMs": { "type": "number", "description": "timeout in milliseconds" }
                },
                "additionalProperties": false
            }
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_five_fixed_tools() {
        let bridge = Bridge::new();
        let response = handle_message(
            &bridge,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        )
        .await
        .unwrap();
        let tools = response["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 5);
        let names: Vec<_> = tools
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            vec!["map", "routine", "snapshot", "act", "wait_for_ui"]
        );
    }

    #[tokio::test]
    async fn empty_bridge_map_via_mcp() {
        let bridge = Bridge::new();
        let response = handle_message(
            &bridge,
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": { "name": "map", "arguments": {} }
            }),
        )
        .await
        .unwrap();
        assert_eq!(
            response["result"]["structuredContent"],
            json!({ "pages": [] })
        );
        assert_eq!(response["result"]["isError"], false);
    }

    #[test]
    fn array_tool_results_are_wrapped_in_records() {
        assert_eq!(
            normalize_tool_result("map", json!([{ "id": "login" }])),
            json!({ "pages": [{ "id": "login" }] })
        );
        assert_eq!(
            normalize_tool_result("routine", json!([{ "from": "login" }])),
            json!({ "edges": [{ "from": "login" }] })
        );
        assert_eq!(
            normalize_tool_result("snapshot", json!([1, 2])),
            json!({ "items": [1, 2] })
        );
    }
}
