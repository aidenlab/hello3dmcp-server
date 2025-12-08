# Understanding Zod Schemas in MCP Servers

## What is Zod?

**Zod** is a TypeScript-first schema validation library that allows you to define schemas that validate and parse data at runtime. It's widely used for:

- API input validation
- Form validation
- Configuration validation
- **MCP tool parameter validation** (our use case)

## Why Zod in MCP Servers?

The Model Context Protocol (MCP) uses Zod schemas to:

1. **Document tool parameters** - AI assistants read these schemas to understand what parameters your tools accept
2. **Validate inputs** - Ensures data is correct before your tool functions execute
3. **Provide clear error messages** - When validation fails, users get helpful feedback
4. **Enable type safety** - Catch errors before they cause problems

When an AI assistant wants to call your MCP tool, it uses the Zod schema to understand what parameters are expected and validate them before execution.

## Our Color Schema Breakdown

Here's how our `colorSchema` works:

```javascript
const colorSchema = z.string()           // 1. Start with: must be a string
  .refine(                               // 2. Add custom validation
    (val) => {                           // 3. Validation function
      // Check if it's a hex code
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        return true;
      }
      // Or check if it's a valid color name
      let normalizedName = val.toLowerCase().trim();
      if (normalizedName === 'seafoam' || normalizedName === 'sea-foam') {
        normalizedName = 'sea foam';
      }
      return appleCrayonColorsHexStrings.has(normalizedName);
    },
    {
      message: `Must be a hex color code...`  // 4. Error message if validation fails
    }
  )
  .describe(`Hex color code or Apple crayon...`);  // 5. Description for AI assistants
```

### Step by Step:

1. **`z.string()`** - Ensures the input is a string type
2. **`.refine()`** - Adds custom validation logic beyond basic type checking
3. **Validation function** - Returns `true` if valid, `false` otherwise
4. **Error message** - Shown to users/AI if validation fails
5. **`.describe()`** - Documentation that helps AI assistants understand what to provide

## How It Works in Practice

When you register a tool like `change_model_color`:

```javascript
inputSchema: {
  color: colorSchema  // The Zod schema validates this parameter
}
```

The MCP SDK:
1. Reads the schema to understand the expected format
2. Validates the input when the tool is called
3. Rejects invalid inputs with your custom error message
4. Passes valid inputs to your handler function

## Other Useful Zod Patterns

Here are some other Zod features you might find useful:

### Basic Types
```javascript
z.number().positive()           // Positive number
z.number().min(0).max(100)      // Number between 0 and 100
z.string().email()              // Valid email address
z.boolean()                     // true or false
```

### Optional Parameters
```javascript
z.string().optional()           // String or undefined
z.string().nullable()           // String or null
```

### Multiple Options
```javascript
z.enum(['red', 'green', 'blue'])  // One of these specific values
z.union([z.string(), z.number()]) // String OR number
```

### Arrays and Objects
```javascript
z.array(z.string())             // Array of strings
z.object({                       // Object with specific shape
  x: z.number(),
  y: z.number(),
  z: z.number()
})
```

### Complex Validation
```javascript
z.string().min(3).max(20)       // String length between 3-20
z.string().regex(/^[A-Z]+$/)    // Custom regex pattern
```

## Example: Size Tool Schema

Looking at our `change_model_size` tool:

```javascript
inputSchema: {
  size: z.number().positive().describe('New size value (uniform scaling)')
}
```

This means:
- Must be a **number**
- Must be **positive** (> 0)
- The **description** helps AI assistants understand what to provide

## Benefits in Our Code

1. **Type Safety** - Catches errors before execution
2. **Self-Documenting** - Schemas describe what's expected
3. **Better AI Understanding** - Clear descriptions help AI assistants use tools correctly
4. **User-Friendly Errors** - Custom messages guide users when something goes wrong

## Real-World Impact

Our color schema enables natural language like:
- "Change the model color to maraschino"
- "Set the background to midnight"
- "Make the key light turquoise"

While still accepting technical hex codes like `#ff0000`, making the API more flexible and user-friendly.

## Resources

- [Zod Documentation](https://zod.dev/)
- [MCP SDK Documentation](https://modelcontextprotocol.io/)
- See `server.js` for implementation examples

