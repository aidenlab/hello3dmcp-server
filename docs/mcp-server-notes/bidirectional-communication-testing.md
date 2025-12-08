# Bidirectional Communication Testing Guide

**Date**: Testing Guide  
**Feature**: Bidirectional State Query and Caching System  
**Purpose**: Comprehensive testing scenarios and prompts for validating bidirectional communication between MCP clients and the 3D app

## Table of Contents

1. [Setup and Prerequisites](#setup-and-prerequisites)
2. [Basic Functionality Tests](#basic-functionality-tests)
3. [State Query Tests](#state-query-tests)
4. [Cache Behavior Tests](#cache-behavior-tests)
5. [Error Handling Tests](#error-handling-tests)
6. [State Consistency Tests](#state-consistency-tests)
7. [Performance Tests](#performance-tests)
8. [Edge Cases](#edge-cases)
9. [Multi-Session Tests](#multi-session-tests)
10. [Integration Tests](#integration-tests)

---

## Setup and Prerequisites

### Before Testing

1. **Start the MCP Server** (if using ChatGPT)
   - For Claude Desktop: The server is automatically started by Claude, no manual action needed
   - For ChatGPT: Manually start the server:
     ```bash
     node server.js
     ```
     Verify it's listening on ports 3000 (MCP) and 3001 (WebSocket)

2. **Open Browser App**
   - Navigate to the app URL with a session ID
   - Example: `http://localhost:5173?sessionId=test-session-123`
   - Verify WebSocket connection shows "connected" status

3. **Connect MCP Client**
   - Configure ChatGPT/Claude Desktop to use the MCP server
   - Verify connection is established

### Monitoring Tools

- **Browser Console**: Watch for state update messages and WebSocket traffic
- **Server Console**: Monitor state cache updates and query requests
- **Network Tab**: Inspect WebSocket messages (if using browser dev tools)

---

## Basic Functionality Tests

### Test 1: Simple State Query

**Goal**: Verify basic state retrieval works

**Conversation Flow**:
```
You: "What color is the model right now?"

Expected Behavior:
- ChatGPT calls get_model_color()
- Returns actual hex color (e.g., "#808080" or current color)
- Response should be accurate, not a placeholder message
```

**Verification**:
- ✅ Response contains actual color value
- ✅ No "coming soon" or placeholder messages
- ✅ Color matches what's displayed in browser

---

### Test 2: Multiple Sequential Queries

**Goal**: Verify multiple queries work in sequence

**Conversation Flow**:
```
You: "Tell me the current state of everything: model color, background color, 
      key light intensity, and camera distance."

Expected Behavior:
- ChatGPT calls multiple getter tools
- Each returns actual state values
- All queries complete successfully
```

**Verification**:
- ✅ All queries return real data
- ✅ Values are consistent with each other
- ✅ No errors or timeouts

---

### Test 3: Query After State Change

**Goal**: Verify state updates after commands

**Conversation Flow**:
```
You: "Change the model color to red, then tell me what color it is now."

Expected Behavior:
1. ChatGPT calls change_model_color with "#ff0000"
2. Browser updates model color
3. Browser sends stateUpdate to server
4. ChatGPT calls get_model_color()
5. Returns "#ff0000"
```

**Verification**:
- ✅ Model color changes in browser
- ✅ State cache updates
- ✅ Query returns new color value
- ✅ Values match between command and query

---

## State Query Tests

### Test 4: Individual Property Queries

**Goal**: Test each getter tool individually

**Test Each Tool**:
```
1. "What is the model rotation?"
   → Tests: get_model_rotation

2. "What is the model scale?"
   → Tests: get_model_scale

3. "What is the key light position?"
   → Tests: get_key_light_position_spherical

4. "What is the key light intensity?"
   → Tests: get_key_light_intensity

5. "What is the key light color?"
   → Tests: get_key_light_color

6. "What is the key light size?"
   → Tests: get_key_light_size

7. "What is the fill light position?"
   → Tests: get_fill_light_position_spherical

8. "What is the fill light intensity?"
   → Tests: get_fill_light_intensity

9. "What is the fill light color?"
   → Tests: get_fill_light_color

10. "What is the fill light size?"
    → Tests: get_fill_light_size

11. "What is the camera distance?"
    → Tests: get_camera_distance

12. "What is the camera FOV?"
    → Tests: get_camera_fov

13. "What is the background color?"
    → Tests: get_background_color
```

**Verification for Each**:
- ✅ Returns actual numeric/string values
- ✅ Values are in correct format (hex codes, degrees, etc.)
- ✅ Values match browser state

---

### Test 5: Force Refresh Parameter

**Goal**: Test forceRefresh functionality

**Conversation Flow**:
```
You: "Get the model color, but force a fresh query from the browser."

Expected Behavior:
- ChatGPT calls get_model_color with forceRefresh: true
- Server queries browser (doesn't use cache)
- Returns fresh state

Then:
You: "Get the model color again (use cache this time)."

Expected Behavior:
- ChatGPT calls get_model_color (forceRefresh defaults to false)
- Server returns cached state immediately
- Response is faster
```

**Verification**:
- ✅ Force refresh queries browser
- ✅ Cache queries return immediately
- ✅ Both return correct values
- ✅ Cache query is faster (check server logs for timing)

---

### Test 6: Conditional Logic Based on State

**Goal**: Test using state queries for decision-making

**Conversation Flow**:
```
You: "If the background is dark (below #808080 brightness), make it lighter. 
      Otherwise, tell me what color it is."

Expected Behavior:
1. ChatGPT calls get_background_color()
2. Calculates brightness from hex
3. Either changes color or reports current color
4. Makes decision based on actual state
```

**Verification**:
- ✅ ChatGPT retrieves state before making decision
- ✅ Decision is based on actual values
- ✅ Action matches the condition

---

### Test 7: Incremental Changes Based on Current State

**Goal**: Test relative adjustments using state queries

**Conversation Flow**:
```
You: "Make the key light 50% brighter than it currently is."

Expected Behavior:
1. ChatGPT calls get_key_light_intensity()
2. Gets current intensity (e.g., 1.0)
3. Calculates new intensity (1.5)
4. Calls set_key_light_intensity with 1.5
5. Verifies with another query
```

**Verification**:
- ✅ ChatGPT queries current state first
- ✅ Calculation is correct
- ✅ New value is applied correctly
- ✅ Final state matches expectation

---

### Test 8: Comparative Operations

**Goal**: Test comparing multiple state values

**Conversation Flow**:
```
You: "Is the key light brighter than the fill light? If not, make it brighter."

Expected Behavior:
1. ChatGPT calls get_key_light_intensity()
2. ChatGPT calls get_fill_light_intensity()
3. Compares values
4. Adjusts if needed
```

**Verification**:
- ✅ Both queries return actual values
- ✅ Comparison is accurate
- ✅ Adjustment is made if needed
- ✅ Final state is correct

---

## Cache Behavior Tests

### Test 9: Cache Hit vs Cache Miss

**Goal**: Verify cache is working correctly

**Test Steps**:
1. Make a change (e.g., change model color to blue)
2. Query the state immediately (should use cache)
3. Check server logs for cache hit
4. Query again (should still use cache)
5. Force refresh (should query browser)

**Verification**:
- ✅ First query after change uses cache
- ✅ Subsequent queries use cache
- ✅ Force refresh queries browser
- ✅ All return correct values

---

### Test 10: Cache Update After Commands

**Goal**: Verify cache updates automatically

**Test Steps**:
1. Query initial state (e.g., model color)
2. Change state (e.g., change model color)
3. Query again immediately
4. Verify new value is returned

**Conversation Flow**:
```
You: "What is the model color?"
[ChatGPT returns: "#808080"]

You: "Change it to red."
[Model changes to red]

You: "What is the model color now?"
[ChatGPT should return: "#ff0000"]
```

**Verification**:
- ✅ Cache updates after each command
- ✅ Query returns updated value
- ✅ No need to force refresh for recent changes

---

### Test 11: Cache Staleness Detection

**Goal**: Test behavior when cache might be stale

**Test Steps**:
1. Query state (populates cache)
2. Manually change state in browser (bypass MCP)
3. Query state again (should return stale cache)
4. Force refresh (should return fresh state)

**Note**: This tests the limitation that manual browser changes won't update cache automatically.

**Verification**:
- ✅ Cache returns last known state
- ✅ Force refresh returns actual current state
- ✅ Difference highlights cache staleness

---

## Error Handling Tests

### Test 12: Browser Disconnection During Query

**Goal**: Test graceful handling of browser disconnection

**Test Steps**:
1. Query state (should work)
2. Close browser tab or disconnect WebSocket
3. Query state again
4. Verify error handling

**Conversation Flow**:
```
You: "What is the model color?"
[Returns actual color]

[Close browser tab]

You: "What is the model color?"
[Should return cached state with warning, or error if no cache]
```

**Verification**:
- ✅ Returns cached state if available
- ✅ Includes warning about disconnection
- ✅ Returns error if no cache available
- ✅ Error message is clear and helpful

---

### Test 13: Query Timeout

**Goal**: Test timeout handling

**Test Steps**:
1. Start a query
2. Simulate browser not responding (or slow network)
3. Verify timeout after 2 seconds
4. Check error message

**Note**: This may be difficult to test without network manipulation. Alternatively, temporarily reduce timeout in code.

**Verification**:
- ✅ Query times out after 2 seconds
- ✅ Error message indicates timeout
- ✅ Pending query is cleaned up
- ✅ Falls back to cache if available

---

### Test 14: Invalid State Response

**Goal**: Test handling of malformed state responses

**Test Steps**:
1. Modify browser to send invalid state response
2. Trigger query
3. Verify error handling

**Note**: Requires code modification for testing. Check that error handling exists in code.

**Verification**:
- ✅ Invalid responses are caught
- ✅ Error messages are clear
- ✅ System recovers gracefully

---

### Test 15: Multiple Simultaneous Queries

**Goal**: Test handling of concurrent queries

**Conversation Flow**:
```
You: "Get the model color, key light intensity, fill light intensity, 
      camera distance, and background color all at once."
```

**Expected Behavior**:
- Multiple queries execute concurrently
- Each gets its own requestId
- All complete successfully
- Responses don't interfere with each other

**Verification**:
- ✅ All queries complete
- ✅ No request ID collisions
- ✅ Responses are correct
- ✅ No race conditions

---

## State Consistency Tests

### Test 16: State Consistency After Multiple Changes

**Goal**: Verify state remains consistent after rapid changes

**Conversation Flow**:
```
You: "Change the model color to red, then blue, then green. 
      After each change, tell me what color it is."
```

**Expected Behavior**:
- Each change updates state
- Each query returns correct current color
- State is consistent throughout

**Verification**:
- ✅ Each change is applied
- ✅ Each query returns correct value
- ✅ Final state matches last change
- ✅ No state corruption

---

### Test 17: State Query During State Change

**Goal**: Test querying while state is changing

**Test Steps**:
1. Start a state change command
2. Immediately query state
3. Verify consistency

**Conversation Flow**:
```
You: "Change the model color to red and immediately tell me what color it is."
```

**Expected Behavior**:
- Command executes
- State updates
- Query returns new color
- Values are consistent

**Verification**:
- ✅ Query waits for state update if needed
- ✅ Returns correct final state
- ✅ No race conditions

---

### Test 18: Complex State Query

**Goal**: Test retrieving comprehensive state

**Conversation Flow**:
```
You: "Give me a complete summary of the current scene state: 
      model properties, lighting setup, camera position, and background."
```

**Expected Behavior**:
- ChatGPT calls multiple getter tools
- Retrieves all state information
- Provides comprehensive summary
- All values are accurate

**Verification**:
- ✅ All properties are queried
- ✅ Values are accurate
- ✅ Summary is complete
- ✅ No missing information

---

## Performance Tests

### Test 19: Cache Performance

**Goal**: Measure performance difference between cache and fresh queries

**Test Steps**:
1. Make a state change
2. Time a cache query (should be < 10ms)
3. Time a force refresh query (should be 100-500ms)
4. Compare performance

**Verification**:
- ✅ Cache queries are fast (< 10ms)
- ✅ Fresh queries are slower but acceptable (100-500ms)
- ✅ Performance difference is noticeable

---

### Test 20: Rapid Sequential Queries

**Goal**: Test system under load

**Conversation Flow**:
```
You: "Query the model color 10 times in a row."
```

**Expected Behavior**:
- All queries complete successfully
- Cache is used for all (fast)
- No performance degradation
- System remains responsive

**Verification**:
- ✅ All queries succeed
- ✅ Performance is consistent
- ✅ No memory leaks
- ✅ System remains stable

---

## Edge Cases

### Test 21: Query Before Any Commands

**Goal**: Test querying state before any changes

**Test Steps**:
1. Open fresh browser session
2. Query state immediately (before any commands)
3. Verify default values are returned

**Verification**:
- ✅ Returns default/initial state values
- ✅ No errors for uninitialized state
- ✅ Values are valid

---

### Test 22: Query After Browser Refresh

**Goal**: Test state after browser refresh

**Test Steps**:
1. Make some state changes
2. Refresh browser page
3. Query state
4. Verify behavior

**Expected Behavior**:
- Browser resets to default state
- Cache may have stale data
- Force refresh returns actual (default) state

**Verification**:
- ✅ Handles browser reset gracefully
- ✅ Force refresh returns correct default state
- ✅ Cache staleness is detected

---

### Test 23: Extreme Values

**Goal**: Test with extreme state values

**Conversation Flow**:
```
You: "Set the key light intensity to 100, then query it."
You: "Set the camera distance to 0.1, then query it."
You: "Set the model scale to 0.001, then query it."
```

**Verification**:
- ✅ Extreme values are set correctly
- ✅ Queries return extreme values accurately
- ✅ No overflow or precision issues

---

### Test 24: Null/Undefined Handling

**Goal**: Test handling of missing state properties

**Test Steps**:
1. Query state when some properties might be undefined
2. Verify graceful handling

**Note**: May require code inspection or edge case simulation.

**Verification**:
- ✅ Missing properties handled gracefully
- ✅ Default values used when appropriate
- ✅ No crashes or errors

---

## Multi-Session Tests

### Test 25: Multiple Browser Sessions

**Goal**: Test state isolation between sessions

**Test Steps**:
1. Open browser session A with sessionId1
2. Open browser session B with sessionId2
3. Change state in session A
4. Query state in session B
5. Verify sessions are isolated

**Verification**:
- ✅ Each session has its own cache
- ✅ Changes in one session don't affect another
- ✅ Queries return session-specific state

---

### Test 26: Session Reconnection

**Goal**: Test behavior when session reconnects

**Test Steps**:
1. Make state changes
2. Disconnect browser
3. Reconnect browser with same session ID
4. Query state
5. Verify cache behavior

**Verification**:
- ✅ Cache persists across disconnection
- ✅ Reconnection works correctly
- ✅ State queries work after reconnection

---

## Integration Tests

### Test 27: End-to-End Workflow

**Goal**: Test complete workflow from command to query

**Conversation Flow**:
```
You: "Set up a dramatic lighting scene: 
      - Model color: dark blue
      - Background: black
      - Key light: bright white at northeast, 45° elevation
      - Fill light: dim blue at southwest, 30° elevation
      - Camera: zoomed in (FOV 0.5)
      
      Then verify everything is set correctly by querying all the properties."
```

**Expected Behavior**:
1. All commands execute
2. State updates after each command
3. Queries return correct values
4. Final verification confirms all settings

**Verification**:
- ✅ All commands execute successfully
- ✅ State updates correctly
- ✅ Queries return accurate values
- ✅ Final state matches intent

---

### Test 28: Conditional Scene Setup

**Goal**: Test building scene based on current state

**Conversation Flow**:
```
You: "If the model is currently blue, make it red. Otherwise, make it blue.
      Then set up complementary lighting based on the final color."
```

**Expected Behavior**:
1. Queries current model color
2. Makes decision based on state
3. Changes color accordingly
4. Sets up lighting based on final color
5. All state queries return correct values

**Verification**:
- ✅ Conditional logic works correctly
- ✅ State queries inform decisions
- ✅ Final scene matches intent

---

### Test 29: State Comparison and Adjustment

**Goal**: Test comparing and adjusting based on state

**Conversation Flow**:
```
You: "Make sure the key light is at least twice as bright as the fill light. 
      If it's not, increase the key light intensity until it is."
```

**Expected Behavior**:
1. Queries both light intensities
2. Compares values
3. Adjusts if needed
4. Verifies final state

**Verification**:
- ✅ Comparison is accurate
- ✅ Adjustments are made correctly
- ✅ Final state meets criteria

---

### Test 30: Error Recovery

**Goal**: Test system recovery from errors

**Test Steps**:
1. Cause an error (e.g., disconnect browser)
2. Attempt to query state
3. Recover (reconnect browser)
4. Verify system works again

**Verification**:
- ✅ Errors are handled gracefully
- ✅ System recovers after error
- ✅ Subsequent queries work correctly

---

## Advanced Testing Scenarios

### Test 31: State Query in Complex Conversation

**Goal**: Test state queries in natural conversation flow

**Conversation Flow**:
```
You: "I want to create a moody scene. Start by checking what the current 
      background color is, and if it's not dark, make it dark. Then set up 
      the lighting to be dramatic - the key light should be much brighter 
      than the fill light. After you're done, verify the setup by telling 
      me all the lighting values."
```

**Verification**:
- ✅ Natural conversation flow works
- ✅ State queries are used appropriately
- ✅ Commands and queries are interleaved correctly
- ✅ Final verification confirms setup

---

### Test 32: State-Based Recommendations

**Goal**: Test ChatGPT making recommendations based on state

**Conversation Flow**:
```
You: "Look at the current scene setup and suggest improvements to make it 
      more visually appealing."
```

**Expected Behavior**:
- ChatGPT queries current state
- Analyzes the setup
- Makes recommendations based on actual values
- Recommendations are relevant to current state

**Verification**:
- ✅ State is queried before recommendations
- ✅ Recommendations are based on actual values
- ✅ Suggestions are relevant and actionable

---

### Test 33: Incremental Refinement

**Goal**: Test iterative refinement using state queries

**Conversation Flow**:
```
You: "Make the key light brighter."
[ChatGPT queries current intensity, increases it]

You: "A bit more."
[ChatGPT queries again, increases further]

You: "Perfect, now adjust the fill light to be half that brightness."
[ChatGPT queries both, calculates, adjusts]
```

**Verification**:
- ✅ Each step queries current state
- ✅ Adjustments are relative to current values
- ✅ Final result is correct
- ✅ Conversation flow is natural

---

## Testing Checklist

Use this checklist to ensure comprehensive testing:

### Basic Functionality
- [ ] Simple state query works
- [ ] Multiple sequential queries work
- [ ] Query after state change returns updated value
- [ ] All 13 getter tools work individually

### Cache Behavior
- [ ] Cache is used for fast queries
- [ ] Cache updates after commands
- [ ] Force refresh queries browser
- [ ] Cache persists across queries

### Error Handling
- [ ] Browser disconnection handled gracefully
- [ ] Timeout handling works
- [ ] Invalid responses handled
- [ ] Multiple simultaneous queries work

### State Consistency
- [ ] State remains consistent after changes
- [ ] Queries return accurate values
- [ ] Complex state queries work
- [ ] State matches browser display

### Performance
- [ ] Cache queries are fast
- [ ] Fresh queries are acceptable speed
- [ ] System handles rapid queries
- [ ] No performance degradation

### Edge Cases
- [ ] Query before any commands works
- [ ] Browser refresh handled correctly
- [ ] Extreme values handled correctly
- [ ] Missing properties handled gracefully

### Multi-Session
- [ ] Sessions are isolated
- [ ] Reconnection works
- [ ] Cache is per-session

### Integration
- [ ] End-to-end workflows work
- [ ] Conditional logic based on state works
- [ ] State comparison and adjustment works
- [ ] Error recovery works

---

## Monitoring During Tests

### Server Console Logs to Watch

- `State cache updated for session X` - Confirms cache updates
- `Routing command to session: X` - Confirms command routing
- `Received state response for requestId: X` - Confirms state responses
- `State query timeout` - Indicates timeout issues
- `Browser disconnected` - Indicates disconnection

### Browser Console Logs to Watch

- `Received command:` - Confirms command receipt
- `State update sent` - Confirms state updates (if logged)
- WebSocket connection status changes

### Things to Verify

1. **State Accuracy**: Do query results match browser display?
2. **Cache Freshness**: Is cache updated after commands?
3. **Response Times**: Are cache queries faster than fresh queries?
4. **Error Messages**: Are errors clear and helpful?
5. **Session Isolation**: Do multiple sessions work independently?

---

## Common Issues to Watch For

### Issue 1: Stale Cache
**Symptom**: Query returns old value after change  
**Check**: Verify stateUpdate is sent after commands  
**Fix**: Ensure `_sendStateUpdate()` is called after all state-modifying commands

### Issue 2: Timeout Errors
**Symptom**: Queries timeout frequently  
**Check**: Browser WebSocket connection status  
**Fix**: Verify browser is connected and responsive

### Issue 3: Request ID Collisions
**Symptom**: Wrong state returned for query  
**Check**: Server logs for request ID handling  
**Fix**: Verify UUID generation is unique

### Issue 4: Cache Not Updating
**Symptom**: Cache returns old values  
**Check**: Verify stateUpdate messages are received  
**Fix**: Check WebSocket message handler for stateUpdate type

### Issue 5: Session Isolation Issues
**Symptom**: Changes in one session affect another  
**Check**: Verify sessionId is used correctly in cache  
**Fix**: Ensure cache keys include sessionId

---

## Success Criteria

The bidirectional communication system is working correctly if:

1. ✅ All getter tools return actual state data (not placeholders)
2. ✅ State queries are fast when using cache (< 10ms)
3. ✅ State queries are accurate when force refreshing
4. ✅ Cache updates automatically after commands
5. ✅ System handles browser disconnection gracefully
6. ✅ Multiple sessions work independently
7. ✅ Error messages are clear and helpful
8. ✅ No breaking changes to existing functionality

---

## Next Steps After Testing

1. **Document Issues**: Note any bugs or unexpected behavior
2. **Performance Metrics**: Record query times and cache hit rates
3. **Edge Case Handling**: Document any edge cases that need improvement
4. **User Experience**: Note any UX improvements needed
5. **Optimization Opportunities**: Identify areas for performance improvement

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Related Documents**: 
- `bidirectional-communication.md` - Architecture and design
- `state-manipulation.md` - Available state functions

