use std::borrow::Cow;
use std::time::Duration;

use sentry::{protocol::Value, types::Dsn, ClientInitGuard, ClientOptions, Level};

const RELEASE_NAME: &str = concat!("terminal-window-manager-tauri@", env!("CARGO_PKG_VERSION"));
const COMPILED_DSN: Option<&str> = option_env!("TWM_SENTRY_DSN");
const COMPILED_ENVIRONMENT: Option<&str> = option_env!("TWM_SENTRY_ENVIRONMENT");

pub fn configure() -> Result<Option<ClientInitGuard>, String> {
    if is_crash_reporting_disabled() {
        return Ok(None);
    }

    let Some(dsn) = configured_dsn()? else {
        return Ok(None);
    };

    let guard = sentry::init(ClientOptions {
        dsn: Some(dsn),
        release: Some(Cow::Borrowed(RELEASE_NAME)),
        environment: configured_environment().map(Cow::Owned),
        attach_stacktrace: true,
        send_default_pii: false,
        traces_sample_rate: 0.0,
        ..Default::default()
    });

    Ok(Some(guard))
}

pub fn capture_renderer_event(
    level: &str,
    source: &str,
    message: &str,
    terminal_id: Option<&str>,
    detail: Option<&str>,
    stack: Option<&str>,
) {
    let Some(sentry_level) = map_report_level(level) else {
        return;
    };

    sentry::with_scope(
        |scope| {
            scope.set_tag("runtime", "renderer");
            scope.set_tag("source", source);

            set_optional_extra(scope, "terminal_id", terminal_id);
            set_optional_extra(scope, "detail", detail);
            set_optional_extra(scope, "renderer_stack", stack);
        },
        || {
            sentry::capture_message(message, sentry_level);
        },
    );
}

pub fn capture_native_event(level: &str, source: &str, message: &str, detail: Option<&str>) {
    let Some(sentry_level) = map_report_level(level) else {
        return;
    };

    sentry::with_scope(
        |scope| {
            scope.set_tag("runtime", "native");
            scope.set_tag("source", source);
            set_optional_extra(scope, "detail", detail);
        },
        || {
            sentry::capture_message(message, sentry_level);
        },
    );
}

pub fn flush_pending_events(timeout: Duration) {
    if let Some(client) = sentry::Hub::current().client() {
        let _ = client.flush(Some(timeout));
    }
}

fn configured_dsn() -> Result<Option<Dsn>, String> {
    let Some(value) = configured_value(&["TWM_SENTRY_DSN", "SENTRY_DSN"], COMPILED_DSN) else {
        return Ok(None);
    };

    value
        .parse::<Dsn>()
        .map(Some)
        .map_err(|error| format!("Invalid Sentry DSN: {error}"))
}

fn configured_environment() -> Option<String> {
    configured_value(
        &["TWM_SENTRY_ENVIRONMENT", "SENTRY_ENVIRONMENT"],
        COMPILED_ENVIRONMENT,
    )
}

fn configured_value(names: &[&str], compiled_value: Option<&str>) -> Option<String> {
    names
        .iter()
        .find_map(|name| std::env::var(name).ok())
        .and_then(|value| normalize_config_value(&value))
        .or_else(|| compiled_value.and_then(normalize_config_value))
}

fn normalize_config_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn is_crash_reporting_disabled() -> bool {
    std::env::var("TWM_DISABLE_CRASH_REPORTING")
        .ok()
        .and_then(|value| normalize_config_value(&value))
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
}

fn map_report_level(level: &str) -> Option<Level> {
    match level.to_ascii_lowercase().as_str() {
        "fatal" => Some(Level::Fatal),
        "error" => Some(Level::Error),
        _ => None,
    }
}

fn set_optional_extra(scope: &mut sentry::Scope, key: &str, value: Option<&str>) {
    if let Some(value) = non_empty(value) {
        scope.set_extra(key, Value::String(value.to_string()));
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_only_error_and_fatal_levels_to_sentry() {
        assert_eq!(map_report_level("fatal"), Some(Level::Fatal));
        assert_eq!(map_report_level("error"), Some(Level::Error));
        assert_eq!(map_report_level("warn"), None);
        assert_eq!(map_report_level("info"), None);
    }

    #[test]
    fn normalizes_empty_configuration_values() {
        assert_eq!(
            normalize_config_value(" https://example.com/1 "),
            Some("https://example.com/1".to_string())
        );
        assert_eq!(normalize_config_value("   "), None);
    }
}
