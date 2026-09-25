//! Byte-stream decoder for Server-Sent Events (the Anthropic streaming format).

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

#[derive(Debug, Default)]
pub struct SseDecoder {
    buffer: Vec<u8>,
    event: String,
    data: Vec<String>,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed raw bytes; returns every event completed by them.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=pos).collect();
            let mut line = String::from_utf8_lossy(&line[..line.len() - 1]).into_owned();
            if line.ends_with('\r') {
                line.pop();
            }
            if let Some(event) = self.line(&line) {
                events.push(event);
            }
        }
        events
    }

    /// Dispatch whatever is pending when the stream ends.
    pub fn finish(&mut self) -> Option<SseEvent> {
        if !self.buffer.is_empty() {
            let line = String::from_utf8_lossy(&std::mem::take(&mut self.buffer)).trim_end_matches('\r').to_string();
            if let Some(event) = self.line(&line) {
                return Some(event);
            }
        }
        self.dispatch()
    }

    fn line(&mut self, line: &str) -> Option<SseEvent> {
        if line.is_empty() {
            return self.dispatch();
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = value.to_string(),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
        None
    }

    fn dispatch(&mut self) -> Option<SseEvent> {
        if self.data.is_empty() {
            self.event.clear();
            return None;
        }
        let event = SseEvent {
            event: if self.event.is_empty() { "message".into() } else { std::mem::take(&mut self.event) },
            data: std::mem::take(&mut self.data).join("\n"),
        };
        Some(event)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_events_split_across_chunks() {
        let mut decoder = SseDecoder::new();
        assert!(decoder.push(b"event: ping\ndata: {\"ty").is_empty());
        let events = decoder.push(b"pe\":\"ping\"}\n\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n");
        assert_eq!(
            events,
            vec![
                SseEvent { event: "ping".into(), data: "{\"type\":\"ping\"}".into() },
                SseEvent { event: "x".into(), data: "a\nb".into() },
            ]
        );
    }

    #[test]
    fn ignores_comments_and_flushes_at_the_end() {
        let mut decoder = SseDecoder::new();
        assert!(decoder.push(b": keepalive\n\ndata: tail").is_empty());
        assert_eq!(decoder.finish(), Some(SseEvent { event: "message".into(), data: "tail".into() }));
    }
}
