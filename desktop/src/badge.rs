use serde::Deserialize;

/// Item from `/api/items?tab=na-mne` – same source and count as the Tasks = Needs you badge in the OS.
#[derive(Deserialize)]
struct Row {
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default, rename = "type")]
    kind: String,
}
#[derive(Deserialize)]
struct Items {
    items: Vec<Row>,
}
#[derive(Deserialize, Default)]
struct Snap {
    #[serde(default)]
    agents: Vec<Agent>,
}
#[derive(Deserialize)]
struct Agent {
    id: String,
    #[serde(default)]
    st: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    pub title: String,
}

/// Needs you (count = `waiting.len()`) and the "urgent" flag (some Needs-you item is type hori).
#[derive(Default, Debug, PartialEq)]
pub struct Badge {
    pub waiting: Vec<Item>,
    pub burning: bool,
}

pub fn parse(body: &str) -> Option<Badge> {
    let s: Items = serde_json::from_str(body).ok()?;
    Some(Badge {
        burning: s.items.iter().any(|i| i.kind == "hori"),
        waiting: s.items.into_iter().map(|i| Item { id: i.id, title: i.text }).collect(),
    })
}

/// Running agents from `/api/snapshot` (only for "Stop all").
pub fn running(body: &str) -> Vec<String> {
    serde_json::from_str::<Snap>(body).unwrap_or_default().agents.into_iter().filter(|a| a.st == "running").map(|a| a.id).collect()
}

/// Items in `now` that aren't in `seen`.
pub fn fresh<'a>(now: &'a [Item], seen: &std::collections::HashSet<String>) -> Vec<&'a Item> {
    now.iter().filter(|i| !seen.contains(&i.id)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = r#"{"items":[{"id":"paperclip:ABC-1","text":"Approve PR","type":"pr"},{"id":"paperclip:ABC-2","text":"Question","type":"hori"}]}"#;

    #[test]
    fn parses_items() {
        let b = parse(BODY).unwrap();
        assert_eq!(b.waiting.len(), 2);
        assert!(b.burning);
        assert!(!parse(r#"{"items":[{"id":"x","type":"pr"}]}"#).unwrap().burning);
    }

    #[test]
    fn tolerates_garbage() {
        assert_eq!(parse(r#"{"items":[]}"#).unwrap(), Badge::default());
        assert!(parse("<html>").is_none());
        assert!(parse(r#"{"error":"unauthorized"}"#).is_none());
    }

    #[test]
    fn detects_new() {
        let b = parse(BODY).unwrap();
        let seen: std::collections::HashSet<String> = ["paperclip:ABC-1".to_string()].into();
        let f = fresh(&b.waiting, &seen);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].id, "paperclip:ABC-2");
    }

    #[test]
    fn running_agents() {
        assert_eq!(running(r#"{"agents":[{"id":"a1","st":"running"},{"id":"a2","st":"error"}]}"#), vec!["a1".to_string()]);
    }
}
