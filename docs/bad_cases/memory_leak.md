# Memory Leak Bad Case

## Problem
Memory leak discovered in WebSocket connection management after 24 hours of continuous operation.

## Root Cause Analysis
The issue was caused by:
1. Not closing idle connections properly
2. Accumulating message buffers without cleanup
3. Missing context cancellation in goroutines

## Error Pattern
```go
// BAD: No cleanup
func handleConnection(conn *websocket.Conn) {
    for {
        _, message, err := conn.ReadMessage()
        if err != nil {
            break // Connection drops but resources not cleaned
        }
        processMessage(message)
    }
}
```

## Resolution
Implemented proper connection lifecycle management:
- Added connection timeouts
- Implemented context cancellation
- Added resource cleanup in defer statements

## Impact
- Memory usage grew from 100MB to 2GB over 24 hours
- Required server restart
- Affected ~50 users during testing

## Prevention
- Add memory profiling in development
- Implement connection pool monitoring
- Add automated load testing