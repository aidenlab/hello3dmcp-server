# How Claude Stores and Uses State Information

## The Question

When Claude receives state information (e.g., "Model color: #ff0000") from an MCP tool, where does it store this information? How does it retrieve it later when you ask to manipulate it?

## The Answer: Conversation Context, Not a Data Structure

**Claude does NOT store state in a separate data structure.** Instead, it uses **conversation context** - the conversation history itself.

### How It Works

1. **Tool Response Becomes Conversation Text**
   - When `get_model_color` returns `"Model color: #ff0000"`, this text is added to the conversation history
   - It becomes part of the messages Claude can "see" in the current conversation

2. **Claude "Remembers" by Reading Context**
   - When you later ask "darken the color," Claude sees the previous message `"Model color: #ff0000"` in the conversation history
   - It uses this information to calculate a darker shade
   - It's not retrieving from a database - it's reading from the conversation context

3. **No Separate Storage**
   - There's no `claude.memory.modelColor = "#ff0000"` variable
   - There's no database or key-value store
   - Everything is in the conversation messages themselves

### Example Flow

```
User: "What color is the model?"
Claude: [Calls get_model_color tool]
Tool Response: "Model color: #ff0000"
Claude: "The model color is #ff0000 (red)."

[This entire exchange is now in the conversation context]

User: "Darken it a bit"
Claude: [Sees "Model color: #ff0000" in conversation history]
Claude: [Calculates darker shade: #cc0000]
Claude: [Calls change_model_color("#cc0000")]
```

### Important Limitations

1. **Single Conversation Only**
   - This "memory" only works within the current conversation
   - If you start a new conversation, Claude won't remember the color
   - You'd need to query it again or tell Claude what it is

2. **Context Window Limits**
   - Claude has a maximum context window (e.g., 200K tokens)
   - Very long conversations may exceed this limit
   - Older messages may be truncated or forgotten

3. **No Guaranteed Accuracy**
   - Claude might misremember or misinterpret information from earlier in the conversation
   - It's better to query fresh state when accuracy matters

### Claude's Memory Feature (Optional)

Claude Desktop has an optional **Memory** feature that provides persistent memory across conversations:
- Stores information in a local memory directory
- Can remember preferences, project contexts, and specific data points
- Must be explicitly enabled in settings
- This is separate from the conversation context mechanism

**Note:** Even with Memory enabled, Claude still primarily uses conversation context for immediate recall. Memory is for longer-term persistence across multiple conversations.

### Why This Matters for Your Application

1. **State Can Become Stale**
   - If Claude "remembers" `"Model color: #ff0000"` from earlier in the conversation
   - But the user manually changed it to `#00ff00` in the browser
   - Claude's "memory" (conversation context) is now wrong
   - This is why `forceRefresh` exists - to get fresh state

2. **Query Before Manipulating**
   - Best practice: Query state right before manipulating it
   - This ensures Claude has the most current information
   - Example: "What's the current rotation?" → "Rotate it 10 degrees clockwise"

3. **Tool Responses Are Authoritative**
   - When Claude receives a tool response, it treats that as the "truth"
   - It will use that information for subsequent decisions
   - This is why accurate state retrieval is important

### Comparison: Your Server Cache vs. Claude's "Memory"

| Aspect | Your Server Cache | Claude's Conversation Context |
|--------|------------------|------------------------------|
| **Storage** | In-memory Map (`sessionStateCache`) | Conversation message history |
| **Persistence** | Per session, cleared on disconnect | Per conversation, cleared on new conversation |
| **Accuracy** | Can be stale (manual interactions) | Can be stale (outdated tool responses) |
| **Refresh** | `forceRefresh` parameter | Query tool again |
| **Speed** | Instant (~0ms) | Depends on context length |
| **Scope** | All state in one object | Individual tool responses |

### Best Practices

1. **Query State When Needed**
   - Don't assume Claude remembers state from earlier
   - Query fresh state before making relative changes (e.g., "darken by 10%")

2. **Use forceRefresh After Manual Interactions**
   - If user manually rotated model, use `forceRefresh: true` to get accurate state

3. **Be Explicit About State**
   - When manipulating state, Claude should query it first
   - Example: "Get the current rotation, then rotate it 10 degrees clockwise"

4. **Don't Rely on Long-Term Memory**
   - For critical operations, always query current state
   - Don't assume Claude remembers from 20 messages ago

### Technical Details: How MCP Tool Responses Work

When Claude calls an MCP tool:

1. **Tool Call**: Claude sends JSON-RPC request to MCP server
   ```json
   {
     "method": "tools/call",
     "params": {
       "name": "get_model_color",
       "arguments": {}
     }
   }
   ```

2. **Tool Response**: MCP server returns result
   ```json
   {
     "content": [
       {
         "type": "text",
         "text": "Model color: #ff0000"
       }
     ]
   }
   ```

3. **Added to Context**: This response becomes part of Claude's conversation context
   - Claude sees: `[Tool: get_model_color] → "Model color: #ff0000"`
   - This text is now available for Claude to reference

4. **Subsequent Use**: When you ask to manipulate it, Claude:
   - Reads the conversation history
   - Finds the tool response with the color
   - Uses that information to make decisions

### Summary

- **Storage**: Conversation context (message history), not a separate data structure
- **Retrieval**: Claude reads from conversation history when generating responses
- **Persistence**: Only within the current conversation
- **Accuracy**: Can become stale; query fresh state when needed
- **Best Practice**: Query state before manipulating, especially for relative changes

