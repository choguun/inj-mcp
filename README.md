# Injective Wallet MCP Server

An MCP server implementation enabling wallet creation and token transfers on the **[Injective](https://injective.com)** blockchain.

## Features

- Wallet Management: Create and manage your Injective wallet
- Token Transfers: Send INJ and other tokens to any Injective address
- Balance Queries: Check your wallet balance for any token denomination

## Functions

### `create-wallet`
- Description: Create a new Injective wallet. If a wallet already exists, returns the existing address.
- Behavior:
    - Creates a new Injective wallet and saves the seed to a secure file.
    - If a wallet already exists, returns the existing wallet address.
    - The wallet information is stored in the Documents directory under the file name injective_wallet.json.

### `transfer-token`
- Description: Transfer tokens from your Injective wallet to another address.
- Inputs:
    - amount (number): Token amount to transfer, greater than 0.
    - recipient (string): Recipient's Injective address (begins with inj).
    - denom (string, optional): Token denomination (default: inj).
- Behavior:
    - Verifies the recipient's address.
    - Performs a token transfer on the Injective blockchain.
    - Returns transaction details including hash and amount.

### `query-balance`
- Description: Query the balance of your Injective wallet.
- Inputs:
    - denom (string, optional): Token denomination (default: inj).
- Behavior:
    - Retrieves the balance of the specified token denomination for your wallet.
    - Returns address and balance information.

### `swap-token`
- Description: Swap one token for another on Injective using spot market orders.
- Inputs:
    - fromDenom (string): Source token denomination (e.g., 'inj', 'peggy0x...').
    - toDenom (string): Destination token denomination (e.g., 'inj', 'factory/...').
    - amount (number): Amount of source token to swap.
    - slippage (number, optional): Slippage tolerance percentage (default: 1%).
- Behavior:
    - Finds the appropriate spot market for the token pair.
    - Places a market order to execute the swap at the best available price.
    - Returns information about the swap including estimated output amount, execution price, and transaction hash.
    - Falls back to simulation mode when a real swap cannot be executed (displays a clear "SIMULATED" label).

## Configuration

### Usage with Claude Desktop

1. Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "injective-wallet": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/dist/index.js"
      ]
    }
  }
}
```

### Testing with MCP Inspector

You can test your MCP server using the MCP Inspector:

```bash
# Install the inspector globally
npm install -g @modelcontextprotocol/inspector

# Run your server with the inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

## Development

To build and run the project:

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run the server
node dist/index.js
```

## License

This MCP server is licensed under the MIT License.

---

## Screenshots

![create account](./ss1.png "create account")
![query balance](./ss2.png "query balance")
![transfer token](./ss3.png "transfer token")
![swap token](./ss4.png "swap token")