# Playground

Easy way to test using the `npx @modelcontextprotocol/inspector`.

### Using

```sh
# 1. start the playground
npm run start:playground

# 2. make your code changes

# 3. test it using the inspector
npx @modelcontextprotocol/inspector
```

The last command will print the MCP Inspector URL. Open it in your browser, change the **Transport Type** to `SSE` and set the **URL** to the playground endpoint `http://localhost:3030/sse`.

### Trying out with Streamable HTTP client

Streamable HTTP is still not supported in the MCP Inspector and has to be tried out by running the following command:

```sh
npx tsx playground/http-streamable-client.ts
```
