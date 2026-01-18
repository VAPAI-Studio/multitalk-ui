# N8N Workflow Setup Guide

This guide explains how to set up n8n workflows to create GitHub issues with proper template variable resolution.

## Problem

When creating GitHub issues via n8n, template variables like `{{ JSON.parse($node["Anthropic"].json.message.content).titulo_issue }}` may appear literally in the issue instead of being resolved to their actual values.

## Solution

### Option 1: Direct JSON Access (Recommended)

If your Anthropic node outputs already-parsed JSON, access fields directly:

**In GitHub "Create Issue" node:**

**Title:**
```
{{ $node["Anthropic"].json.titulo_issue }}
```

**Body:**
```
{{ $node["Anthropic"].json.descripcion_issue }}
```

### Option 2: Parse JSON String

If the Anthropic output contains a JSON string in `message.content`:

**Add a "Code" node between Anthropic and GitHub nodes:**

```javascript
// Code node: Parse Anthropic Response
const messageContent = $input.first().json.message.content;

// Parse the JSON string
const parsed = JSON.parse(messageContent);

return {
  json: {
    titulo: parsed.titulo_issue || "Untitled Issue",
    descripcion: parsed.descripcion_issue || "No description provided"
  }
};
```

**Then in GitHub node:**

**Title:**
```
{{ $json.titulo }}
```

**Body:**
```
{{ $json.descripcion }}
```

### Option 3: Use Set Node for Mapping

**Add a "Set" node between Anthropic and GitHub:**

1. Add field: `titulo`
   - Value: `{{ $json.message.content.titulo_issue }}`

2. Add field: `descripcion`
   - Value: `{{ $json.message.content.descripcion_issue }}`

**Then in GitHub node:**

**Title:**
```
{{ $json.titulo }}
```

**Body:**
```
{{ $json.descripcion }}
```

## Debugging Template Variables

### 1. Check Anthropic Node Output

After running the workflow:
1. Click on the Anthropic node
2. View the "OUTPUT" tab
3. Examine the JSON structure
4. Verify the path to your data

### 2. Test Expressions

In n8n, you can test expressions:
1. Click on any node
2. Click the "+" icon next to a field
3. Select "Expression"
4. Type your expression
5. Click "Test" to see the result

### 3. Common Expression Patterns

**Access top-level field:**
```
{{ $json.field_name }}
```

**Access nested field:**
```
{{ $json.parent.child }}
```

**Access previous node:**
```
{{ $node["NodeName"].json.field }}
```

**Access array item:**
```
{{ $json.items[0].field }}
```

**Parse JSON string:**
```
{{ JSON.parse($json.string_field).nested_field }}
```

## Example Workflow

Here's a complete example workflow:

```json
{
  "nodes": [
    {
      "parameters": {
        "model": "claude-3-5-sonnet-20241022",
        "prompt": "Generate a bug report with title and description in JSON format"
      },
      "name": "Anthropic",
      "type": "n8n-nodes-base.anthropic"
    },
    {
      "parameters": {
        "jsCode": "const content = $input.first().json.message.content;\nconst parsed = JSON.parse(content);\n\nreturn {\n  json: {\n    title: parsed.titulo_issue,\n    description: parsed.descripcion_issue\n  }\n};"
      },
      "name": "Parse Response",
      "type": "n8n-nodes-base.code"
    },
    {
      "parameters": {
        "resource": "issue",
        "operation": "create",
        "owner": "VAPAI-Studio",
        "repository": "multitalk-ui",
        "title": "={{ $json.title }}",
        "body": "={{ $json.description }}"
      },
      "name": "GitHub",
      "type": "n8n-nodes-base.github"
    }
  ],
  "connections": {
    "Anthropic": {
      "main": [[{ "node": "Parse Response" }]]
    },
    "Parse Response": {
      "main": [[{ "node": "GitHub" }]]
    }
  }
}
```

## Anthropic Response Format

When using Anthropic's API, ensure your prompt instructs it to return valid JSON:

**Example Prompt:**
```
Please analyze this bug and provide a response in the following JSON format:
{
  "titulo_issue": "Brief title for the bug",
  "descripcion_issue": "Detailed description of the bug"
}

Only return valid JSON, no additional text.
```

## Validation

To ensure your workflow works correctly:

1. **Test with sample data first**
   - Use a "Manual Trigger" node
   - Add test JSON data
   - Verify each node's output

2. **Add error handling**
   - Use "IF" nodes to check for empty values
   - Add "Set" nodes to provide defaults
   - Log errors to a database or notification service

3. **Monitor production**
   - Check GitHub issues regularly
   - Set up notifications for failed workflows
   - Review n8n execution logs

## Common Issues

### Issue: Variables appear literally

**Cause:** Expression evaluation is disabled or incorrect syntax

**Solution:**
- Use `={{ }}` instead of `{{ }}`
- Enable expression mode in the field
- Check for syntax errors

### Issue: "Cannot read property of undefined"

**Cause:** The path to the data is incorrect

**Solution:**
- Check the actual output structure
- Use optional chaining: `$json?.field?.nested`
- Add null checks in Code nodes

### Issue: JSON.parse() fails

**Cause:** The content is not valid JSON

**Solution:**
- Verify Anthropic returns valid JSON
- Add try/catch in Code node:

```javascript
try {
  const parsed = JSON.parse($json.content);
  return { json: parsed };
} catch (error) {
  return {
    json: {
      error: "Failed to parse JSON",
      raw: $json.content
    }
  };
}
```

## Best Practices

1. **Always validate Anthropic output format**
   - Add schema validation in Code node
   - Provide default values for missing fields
   - Log invalid responses for debugging

2. **Use intermediate nodes**
   - Don't try to do everything in one expression
   - Add "Code" or "Set" nodes to transform data
   - Makes debugging much easier

3. **Test thoroughly**
   - Test with various inputs
   - Test error cases (missing fields, invalid JSON)
   - Verify GitHub issues are created correctly

4. **Document your workflow**
   - Add notes to nodes explaining what they do
   - Document expected input/output formats
   - Share workflow JSON with team

## Support

If you continue to have issues:

1. Check n8n documentation: https://docs.n8n.io/
2. Review Anthropic API docs: https://docs.anthropic.com/
3. Test expressions in n8n's expression editor
4. Use GitHub issue templates instead of automation for complex cases

## Related Files

- `.github/ISSUE_TEMPLATE/bug_report.yml` - Structured bug report template
- `.github/ISSUE_TEMPLATE/feature_request.yml` - Feature request template
- `CLAUDE.md` - Project overview and guidelines
