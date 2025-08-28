/**
 * Example: Simple HTTP Client for Azure AD OAuth Server
 * 
 * This client demonstrates how to interact with an MCP server that uses
 * Azure AD OAuth authentication via direct HTTP requests.
 */

interface AuthConfig {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  authBaseUrl?: string;
  redirectUri?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

class AzureADOAuthClient {
  constructor(private config: AuthConfig) {
    // Set default values
    this.config.authBaseUrl = config.authBaseUrl || `${config.serverUrl}/auth`;
    this.config.redirectUri = config.redirectUri || `${config.serverUrl}/auth/callback`;
  }

  /**
   * Step 1: Get the authorization URL for Azure AD login
   */
  getAuthorizationUrl(state?: string, codeChallenge?: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri!,
      scope: 'openid profile email User.Read',
      state: state || 'random-state-' + Math.random().toString(36),
    });

    if (codeChallenge) {
      params.append('code_challenge', codeChallenge);
      params.append('code_challenge_method', 'S256');
    }

    return `${this.config.authBaseUrl}/authorize?${params.toString()}`;
  }

  /**
   * Step 2: Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string, state: string, codeVerifier?: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri!,
      state,
    });

    if (codeVerifier) {
      body.append('code_verifier', codeVerifier);
    }

    const response = await fetch(`${this.config.authBaseUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  /**
   * Make authenticated HTTP request to MCP server
   */
  private async mcpRequest(endpoint: string, method: string, accessToken: string, body?: any): Promise<any> {
    const url = `${this.config.serverUrl}/mcp${endpoint}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MCP request failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  /**
   * List available tools
   */
  async listTools(accessToken: string): Promise<any> {
    console.log('\n📋 Listing available tools...');
    const result = await this.mcpRequest('/tools/list', 'POST', accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    console.log('Available tools:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Call a tool
   */
  async callTool(accessToken: string, name: string, args: any = {}): Promise<any> {
    console.log(`\n🔧 Calling tool: ${name}`);
    console.log('Arguments:', JSON.stringify(args, null, 2));
    
    const result = await this.mcpRequest('/tools/call', 'POST', accessToken, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    });
    console.log('Result:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * List available resources
   */
  async listResources(accessToken: string): Promise<any> {
    console.log('\n📚 Listing available resources...');
    const result = await this.mcpRequest('/resources/list', 'POST', accessToken, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/list',
      params: {},
    });
    console.log('Available resources:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Read a resource
   */
  async readResource(accessToken: string, uri: string): Promise<any> {
    console.log(`\n📖 Reading resource: ${uri}`);
    const result = await this.mcpRequest('/resources/read', 'POST', accessToken, {
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri },
    });
    console.log('Resource content:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * List available prompts
   */
  async listPrompts(accessToken: string): Promise<any> {
    console.log('\n💭 Listing available prompts...');
    const result = await this.mcpRequest('/prompts/list', 'POST', accessToken, {
      jsonrpc: '2.0',
      id: 5,
      method: 'prompts/list',
      params: {},
    });
    console.log('Available prompts:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Get a prompt
   */
  async getPrompt(accessToken: string, name: string, args: any = {}): Promise<any> {
    console.log(`\n💬 Getting prompt: ${name}`);
    console.log('Arguments:', JSON.stringify(args, null, 2));
    
    const result = await this.mcpRequest('/prompts/get', 'POST', accessToken, {
      jsonrpc: '2.0',
      id: 6,
      method: 'prompts/get',
      params: {
        name,
        arguments: args,
      },
    });
    console.log('Prompt result:', JSON.stringify(result, null, 2));
    return result;
  }
}

// Example usage with manual OAuth flow
async function interactiveExample() {
  const config: AuthConfig = {
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    clientId: process.env.AZURE_AD_CLIENT_ID || 'your-azure-app-client-id',
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET || 'your-azure-app-client-secret',
  };

  const client = new AzureADOAuthClient(config);

  try {
    // Step 1: Display authorization URL
    const authUrl = client.getAuthorizationUrl();
    console.log('\n🔐 Azure AD OAuth Flow');
    console.log('========================================');
    console.log('\n1. Open this URL in your browser to log in with Azure AD:');
    console.log(`   ${authUrl}`);
    console.log('\n2. After authentication, you will be redirected to the callback URL');
    console.log('3. Copy the "code" parameter from the callback URL');
    console.log('4. Set the CODE environment variable and run this script again');
    console.log('\nExample:');
    console.log('   export CODE=your-authorization-code-here');
    console.log(`   node ${__filename.split('/').pop()}`);
    
    // If authorization code is provided, proceed with token exchange
    const code = process.env.CODE;
    if (!code) {
      console.log('\n⏸️  Waiting for authorization code...');
      console.log('Please complete the OAuth flow and set CODE environment variable.');
      return;
    }

    console.log('\n🔄 Exchanging authorization code for access token...');
    const tokenResponse = await client.exchangeCodeForToken(code, 'random-state');
    console.log('Token response:', tokenResponse);

    // Step 3: Test MCP functionality with access token
    await client.listTools(tokenResponse.access_token);
    await client.listResources(tokenResponse.access_token);
    await client.listPrompts(tokenResponse.access_token);

    // Try calling a tool
    try {
      await client.callTool(tokenResponse.access_token, 'greeting', { name: 'Azure AD User' });
    } catch (error) {
      console.log('Note: greeting tool might not be available');
    }

    // Try reading a resource
    try {
      await client.readResource(tokenResponse.access_token, 'mcp://greeting/hello');
    } catch (error) {
      console.log('Note: greeting resource might not be available');
    }

    // Try getting a prompt
    try {
      await client.getPrompt(tokenResponse.access_token, 'greeting', { name: 'Azure AD User' });
    } catch (error) {
      console.log('Note: greeting prompt might not be available');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the interactive example if this file is executed directly
if (require.main === module) {
  console.log('🚀 Azure AD OAuth Client Example');
  console.log('==================================');
  console.log('\n📋 Prerequisites:');
  console.log('1. Start the Azure AD OAuth server: npm run start:azure-ad-oauth');
  console.log('2. Configure Azure AD App Registration');
  console.log('3. Set environment variables:');
  console.log('   - AZURE_AD_CLIENT_ID=<your-client-id>');
  console.log('   - AZURE_AD_CLIENT_SECRET=<your-client-secret>');
  console.log('   - SERVER_URL=http://localhost:3000 (optional)');

  interactiveExample().catch(console.error);
}

export { AzureADOAuthClient };
export type { AuthConfig };
