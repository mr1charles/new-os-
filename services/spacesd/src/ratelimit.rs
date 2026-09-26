//! Failed password attempts, per caller. Five failures within a minute lock that caller out;
//! the lockout doubles each time (30 s up to 15 min) and a success clears everything.

use std::collections::HashMap;
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(60);
const MAX_FAILURES: usize = 5;
const FIRST_LOCKOUT: Duration = Duration::from_secs(30);
const MAX_LOCKOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
struct Caller {
    failures: Vec<Instant>,
    locked_until: Option<Instant>,
    lockouts: u32,
}

#[derive(Default)]
pub struct RateLimiter {
    callers: HashMap<u32, Caller>,
}

impl RateLimiter {
    /// Seconds to wait before `caller` may try again, or None when it may try now.
    pub fn wait(&self, caller: u32, now: Instant) -> Option<u64> {
        let until = self.callers.get(&caller)?.locked_until?;
        (until > now).then(|| (until - now).as_secs().max(1))
    }

    pub fn failure(&mut self, caller: u32, now: Instant) {
        let entry = self.callers.entry(caller).or_default();
        entry.failures.retain(|t| now.duration_since(*t) < WINDOW);
        entry.failures.push(now);
        if entry.failures.len() >= MAX_FAILURES {
            let lockout = FIRST_LOCKOUT.saturating_mul(1 << entry.lockouts.min(10)).min(MAX_LOCKOUT);
            entry.locked_until = Some(now + lockout);
            entry.lockouts += 1;
            entry.failures.clear();
        }
    }

    pub fn success(&mut self, caller: u32) {
        self.callers.remove(&caller);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locks_out_after_five_failures_and_doubles() {
        let mut limiter = RateLimiter::default();
        let t0 = Instant::now();
        for i in 0..4 {
            limiter.failure(7, t0 + Duration::from_secs(i));
            assert_eq!(limiter.wait(7, t0 + Duration::from_secs(i)), None);
        }
        limiter.failure(7, t0 + Duration::from_secs(5));
        assert_eq!(limiter.wait(7, t0 + Duration::from_secs(5)), Some(30));
        assert_eq!(limiter.wait(8, t0), None, "other callers are unaffected");
        // After the lockout, five more failures lock for twice as long.
        let t1 = t0 + Duration::from_secs(40);
        assert_eq!(limiter.wait(7, t1), None);
        for i in 0..5 {
            limiter.failure(7, t1 + Duration::from_secs(i));
        }
        assert_eq!(limiter.wait(7, t1 + Duration::from_secs(4)), Some(60));
        limiter.success(7);
        assert_eq!(limiter.wait(7, t1 + Duration::from_secs(5)), None);
    }

    #[test]
    fn old_failures_expire() {
        let mut limiter = RateLimiter::default();
        let t0 = Instant::now();
        for i in 0..4 {
            limiter.failure(1, t0 + Duration::from_secs(i));
        }
        // A minute later the earlier four no longer count.
        limiter.failure(1, t0 + Duration::from_secs(90));
        assert_eq!(limiter.wait(1, t0 + Duration::from_secs(90)), None);
    }
}
