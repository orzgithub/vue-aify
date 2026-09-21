//! Browser-safe ticket format + Node/Rust-side issuer and auth store.
//!
//! The on-the-wire credential is the same base64 JSON object used by the
//! TypeScript implementation:
//!
//! ```json
//! { "url": "ws://127.0.0.1:7799", "token": "...", "issuedAt": 123, "expiresAt": 456 }
//! ```

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Result};
use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectTicket {
    pub url: String,
    pub token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub issued_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct IssueTicketOptions {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub secure: Option<bool>,
    pub kind: Option<String>,
    pub ttl_ms: Option<u64>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn issue_ticket(opts: IssueTicketOptions) -> ConnectTicket {
    let host = opts.host.unwrap_or_else(|| "127.0.0.1".to_string());
    let port = opts.port.unwrap_or(7799);
    let secure = opts.secure.unwrap_or(false);
    let issued_at = now_ms();
    ConnectTicket {
        url: format!("{}://{}:{}", if secure { "wss" } else { "ws" }, host, port),
        token: random_token(),
        kind: opts.kind,
        issued_at,
        expires_at: opts.ttl_ms.map(|ttl| issued_at.saturating_add(ttl)),
    }
}

pub fn encode_ticket(ticket: &ConnectTicket) -> Result<String> {
    let json = serde_json::to_vec(ticket)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(json))
}

pub fn decode_ticket(credential: &str) -> Result<ConnectTicket> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(credential.trim())
        .map_err(|_| anyhow!("invalid connection ticket"))?;
    let ticket: ConnectTicket =
        serde_json::from_slice(&bytes).map_err(|_| anyhow!("invalid connection ticket"))?;
    if ticket.url.is_empty() || ticket.token.is_empty() {
        return Err(anyhow!("invalid connection ticket"));
    }
    Ok(ticket)
}

pub fn is_expired(ticket: &ConnectTicket) -> bool {
    ticket
        .expires_at
        .map(|expires_at| expires_at <= now_ms())
        .unwrap_or(false)
}

/// In-memory token allow-list. A `None` expiry means the token never expires
/// (legacy hardcoded token).
#[derive(Default)]
pub struct TicketStore {
    tokens: RwLock<HashMap<String, Option<u64>>>,
}

impl TicketStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&self, token: impl Into<String>, expires_at: Option<u64>) {
        self.tokens
            .write()
            .unwrap()
            .insert(token.into(), expires_at);
    }

    pub fn is_valid(&self, token: &str) -> bool {
        let mut guard = self.tokens.write().unwrap();
        let Some(expires_at) = guard.get(token).copied() else {
            return false;
        };
        if let Some(expires_at) = expires_at {
            if expires_at <= now_ms() {
                guard.remove(token);
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticket_round_trips() {
        let ticket = issue_ticket(IssueTicketOptions {
            host: Some("127.0.0.1".into()),
            port: Some(7799),
            ttl_ms: Some(60_000),
            ..Default::default()
        });
        let encoded = encode_ticket(&ticket).unwrap();
        let decoded = decode_ticket(&encoded).unwrap();
        assert_eq!(decoded.url, "ws://127.0.0.1:7799");
        assert_eq!(decoded.token, ticket.token);
        assert!(!is_expired(&decoded));
    }

    #[test]
    fn expired_token_is_rejected() {
        let store = TicketStore::new();
        store.add("expired", Some(now_ms().saturating_sub(1)));
        assert!(!store.is_valid("expired"));
        store.add("valid", Some(now_ms().saturating_add(60_000)));
        assert!(store.is_valid("valid"));
    }
}
