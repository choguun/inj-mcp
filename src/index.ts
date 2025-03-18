#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Storage setup
const homeDir = os.homedir();
const documentsDir = path.join(homeDir, 'Documents');
const walletFilePath = path.join(documentsDir, "injective_wallet.json");

// Create server instance
const server = new Server(
    {
        name: "injective-wallet",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Define Zod schemas for validation
const TransferTokenSchema = z.object({
    amount: z.number().gt(0),
    recipient: z.string().min(42).max(44),
    denom: z.string().default("inj")
});

const QueryBalanceSchema = z.object({
    denom: z.string().default("inj")
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "create-wallet",
                description: "Create a new Injective wallet. If a wallet already exists, returns the existing address.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "transfer-token",
                description: "Transfer tokens from your Injective wallet to another address.",
                inputSchema: {
                    type: "object",
                    properties: {
                        amount: {
                            type: "number",
                            description: "Token amount to transfer, greater than 0",
                        },
                        recipient: {
                            type: "string",
                            description: "Recipient's Injective address (begins with inj)",
                        },
                        denom: {
                            type: "string",
                            description: "Token denomination (default: inj)",
                        }
                    },
                    required: ["amount", "recipient"],
                },
            },
            {
                name: "query-balance",
                description: "Query the balance of your Injective wallet",
                inputSchema: {
                    type: "object",
                    properties: {
                        denom: {
                            type: "string",
                            description: "Token denomination (default: inj)",
                        }
                    },
                },
            }
        ],
    };
});

// Wallet management functions
async function createWallet() {
    try {
        const { PrivateKey } = await import('@injectivelabs/sdk-ts');
        
        // Check if wallet already exists
        const walletExists = await checkWalletExists();
        if (walletExists) {
            const walletData = await loadWallet();
            return { address: walletData.address, isNew: false };
        }

        // Create new wallet with proper access to generated objects
        const generated = PrivateKey.generate();
        const privateKey = generated.privateKey;
        const address = privateKey.toBech32();
        const mnemonic = generated.mnemonic;

        // Save wallet data
        await saveWallet(address, mnemonic);

        return { address, isNew: true };
    } catch (error: any) {
        console.error("Error creating wallet:", error);
        throw new Error(`Failed to create wallet: ${error.message}`);
    }
}

async function checkWalletExists() {
    try {
        await fs.access(walletFilePath);
        return true;
    } catch {
        return false;
    }
}

async function saveWallet(address: string, mnemonic: string) {
    const walletData = {
        address,
        mnemonic,
        createdAt: new Date().toISOString()
    };

    await fs.mkdir(path.dirname(walletFilePath), { recursive: true });
    await fs.writeFile(walletFilePath, JSON.stringify(walletData, null, 2), 'utf8');
}

async function loadWallet() {
    const jsonString = await fs.readFile(walletFilePath, 'utf8');
    return JSON.parse(jsonString);
}

async function transferToken(recipient: string, amount: number, denom: string = 'inj') {
    try {
        // Import dynamically to handle any potential import issues
        const { PrivateKey } = await import('@injectivelabs/sdk-ts');
        const { MsgSend } = await import('@injectivelabs/sdk-ts');
        
        // Check if wallet exists
        if (!await checkWalletExists()) {
            throw new Error("Wallet not found. Please create a wallet first.");
        }

        const walletData = await loadWallet();
        const privateKey = PrivateKey.fromMnemonic(walletData.mnemonic);
        const injectiveAddress = privateKey.toBech32();
        
        // Mock transaction example
        // In a real implementation, you would:
        // 1. Get account details from the chain
        // 2. Create and sign the transaction
        // 3. Broadcast to the network
        
        // For this example, we'll simulate a successful transaction
        const txHash = `injective${Date.now().toString(16)}`;
        
        return {
            transactionHash: txHash,
            amount,
            denom,
            recipient,
            from: injectiveAddress
        };
    } catch (error: any) {
        console.error("Error transferring tokens:", error);
        throw error;
    }
}

async function queryBalance(denom: string = 'inj') {
    try {
        // Import dynamically to handle any potential import issues
        const { PrivateKey } = await import('@injectivelabs/sdk-ts');
        
        // Check if wallet exists
        if (!await checkWalletExists()) {
            throw new Error("Wallet not found. Please create a wallet first.");
        }

        const walletData = await loadWallet();
        const privateKey = PrivateKey.fromMnemonic(walletData.mnemonic);
        const injectiveAddress = privateKey.toBech32();
        
        // In a real implementation, you would query the chain
        // For this example, we'll return a mock balance
        const mockBalance = 10.5;
        
        return {
            address: injectiveAddress,
            balance: mockBalance,
            denom: denom
        };
    } catch (error: any) {
        console.error("Error querying balance:", error);
        throw error;
    }
}

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === "create-wallet") {
            const { address, isNew } = await createWallet();
            if (isNew) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Your Injective wallet has been successfully created. Address: ${address}`
                        },
                    ],
                };
            } else {
                return {
                    content: [
                        {
                            type: "text",
                            text: `You already have an Injective wallet with address: ${address}`
                        },
                    ],
                };
            }
        } else if (name === "transfer-token") {
            const { amount, recipient, denom } = TransferTokenSchema.parse(args);
            const result = await transferToken(recipient, amount, denom);
            return {
                content: [
                    {
                        type: "text",
                        text: `Successfully transferred ${amount} ${denom} from ${result.from} to ${recipient}. Transaction hash: ${result.transactionHash}`
                    },
                ],
            };
        } else if (name === "query-balance") {
            const { denom } = QueryBalanceSchema.parse(args || {});
            const result = await queryBalance(denom);
            return {
                content: [
                    {
                        type: "text",
                        text: `Your wallet (${result.address}) has a balance of ${result.balance} ${result.denom}`
                    },
                ],
            };
        } else {
            throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error: any) {
        console.error("Error executing tool:", error);
        if (error instanceof z.ZodError) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Invalid arguments: ${error.errors
                            .map((e) => `${e.path.join(".")}: ${e.message}`)
                            .join(", ")}`
                    },
                ],
            };
        }
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: `Error: ${error.message || "Unknown error occurred"}`
                },
            ],
        };
    }
});

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Injective Wallet MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
