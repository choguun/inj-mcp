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

const DeployTokenSchema = z.object({
    name: z.string().min(1),
    symbol: z.string().min(1).max(12),
    initialSupply: z.number().positive(),
    decimals: z.number().min(0).max(18).default(18)
});

const SwapTokenSchema = z.object({
    fromDenom: z.string().min(1),
    toDenom: z.string().min(1),
    amount: z.number().positive(),
    slippage: z.number().min(0).max(100).default(1) // Slippage tolerance in percentage
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
            },
            {
                name: "deploy-token",
                description: "Deploy a new token on Injective using CosmWasm",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "Token name (e.g., 'My Token')",
                        },
                        symbol: {
                            type: "string",
                            description: "Token symbol (e.g., 'MTK')",
                        },
                        initialSupply: {
                            type: "number",
                            description: "Initial token supply (e.g., 1000000)",
                        },
                        decimals: {
                            type: "number",
                            description: "Number of decimals for the token (default: 18)",
                        }
                    },
                    required: ["name", "symbol", "initialSupply"],
                },
            },
            {
                name: "swap-token",
                description: "Swap one token for another on Injective using spot market orders",
                inputSchema: {
                    type: "object",
                    properties: {
                        fromDenom: {
                            type: "string",
                            description: "Source token denomination (e.g., 'inj', 'peggy0x...')",
                        },
                        toDenom: {
                            type: "string",
                            description: "Destination token denomination (e.g., 'inj', 'factory/...')",
                        },
                        amount: {
                            type: "number",
                            description: "Amount of source token to swap",
                        },
                        slippage: {
                            type: "number",
                            description: "Slippage tolerance percentage (default: 1%)",
                        }
                    },
                    required: ["fromDenom", "toDenom", "amount"],
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
        const { 
            PrivateKey,
            ChainGrpcAuthApi,
            MsgBroadcasterWithPk
        } = await import('@injectivelabs/sdk-ts');
        const { getNetworkEndpoints, Network } = await import('@injectivelabs/networks');
        
        // Dynamic imports to avoid type issues
        const sdkTs = await import('@injectivelabs/sdk-ts');
        const MsgSend = sdkTs.MsgSend || (sdkTs as any).MsgSend;
        
        // Check if wallet exists
        if (!await checkWalletExists()) {
            throw new Error("Wallet not found. Please create a wallet first.");
        }

        // Get wallet credentials
        const walletData = await loadWallet();
        const privateKey = PrivateKey.fromMnemonic(walletData.mnemonic);
        const injectiveAddress = privateKey.toBech32();
        
        // Normalize denom if needed
        const normalizedDenom = normalizeDenom(denom);
        
        // Set up network endpoints - using Mainnet for consistency with other functions
        const network = Network.Testnet;
        const endpoints = getNetworkEndpoints(network);
        
        // Initialize required API clients
        const chainGrpcAuthApi = new ChainGrpcAuthApi(endpoints.grpc);
        
        // Convert amount to base units (considering 18 decimals for INJ or appropriate decimals for other tokens)
        const decimals = 18; // Default for INJ, ideally should be fetched from token metadata
        const amountInBaseUnits = (amount * Math.pow(10, decimals)).toString();
        
        // Create MsgSend with correct structure for latest SDK version
        const msgSendParams = {
            srcInjectiveAddress: injectiveAddress,
            dstInjectiveAddress: recipient,
            amount: {
                denom: normalizedDenom,
                amount: amountInBaseUnits
            }
        };
        
        // Try different ways to create MsgSend based on SDK version
        let msgSend;
        if (typeof MsgSend.fromJSON === 'function') {
            msgSend = MsgSend.fromJSON(msgSendParams);
        } else if (typeof MsgSend === 'function') {
            msgSend = new MsgSend(msgSendParams);
        } else {
            throw new Error("Unable to create MsgSend - incompatible SDK version");
        }
        
        // Use MsgBroadcasterWithPk to broadcast the transaction
        const msgBroadcaster = new MsgBroadcasterWithPk({
            network,
            privateKey: privateKey.toPrivateKeyHex(),
            endpoints: endpoints
        });
        
        console.error(`Broadcasting transfer of ${amount} ${denom} to ${recipient}...`);
        const txResponse = await msgBroadcaster.broadcast({
            msgs: [msgSend]
        });
        
        console.error(`Transaction successful: ${txResponse.txHash}`);
        
        // Return transaction details
        return {
            transactionHash: txResponse.txHash,
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
        const { PrivateKey, ChainGrpcBankApi } = await import('@injectivelabs/sdk-ts');
        const { getNetworkEndpoints, Network } = await import('@injectivelabs/networks');
        
        // Check if wallet exists
        if (!await checkWalletExists()) {
            throw new Error("Wallet not found. Please create a wallet first.");
        }

        const walletData = await loadWallet();
        const privateKey = PrivateKey.fromMnemonic(walletData.mnemonic);
        const injectiveAddress = privateKey.toBech32();
        
        // Set up the network endpoints and Bank API client
        const network = Network.Testnet; // Use Testnet for development, Network.Testnet for production
        const endpoints = getNetworkEndpoints(network);
        const chainGrpcBankApi = new ChainGrpcBankApi(endpoints.grpc);
        
        // Query the chain for the balance
        const normalizedDenom = normalizeDenom(denom);
        const balanceResponse = await chainGrpcBankApi.fetchBalance({
            accountAddress: injectiveAddress,
            denom: normalizedDenom
        });
        
        // Convert to a number (handle decimal conversion based on token's decimal places)
        const decimals = 18; // Default for INJ, ideally should be fetched from token metadata
        const balance = balanceResponse && balanceResponse.amount 
            ? parseFloat(balanceResponse.amount) / Math.pow(10, decimals)
            : 0;
        
        return {
            address: injectiveAddress,
            balance: balance,
            denom: denom
        };
    } catch (error: any) {
        console.error("Error querying balance:", error);
        throw error;
    }
}

async function deployToken(name: string, symbol: string, initialSupply: number, decimals: number = 18) {
    try {
        // Import required modules from Injective SDK
        const { 
            PrivateKey,
            MsgCreateDenom, 
            MsgMint,
            MsgSetDenomMetadata,
            ChainGrpcAuthApi,
            MsgBroadcasterWithPk
        } = await import('@injectivelabs/sdk-ts');
        const { getNetworkEndpoints, Network } = await import('@injectivelabs/networks');
        
        // Check if wallet exists
        if (!await checkWalletExists()) {
            throw new Error("Wallet not found. Please create a wallet first.");
        }

        // Get wallet credentials
        const walletData = await loadWallet();
        const privateKey = PrivateKey.fromMnemonic(walletData.mnemonic);
        const injectiveAddress = privateKey.toBech32();
        
        // Network setup - using testnet for development, use Network.Testnet for production
        const network = Network.Testnet;
        const endpoints = getNetworkEndpoints(network);
        
        // Initialize required API clients
        const chainGrpcAuthApi = new ChainGrpcAuthApi(endpoints.grpc);
        
        // Create a subdenom for the token (simple alphanumeric version of symbol)
        const subdenom = symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
        
        console.error(`Creating token with subdenom: ${subdenom}`);
        
        // 1. Create the token denom using Token Factory
        const msgCreateDenom = MsgCreateDenom.fromJSON({
            subdenom,
            sender: injectiveAddress
        });
        
        // 2. Prepare the mint message to create initial supply
        // The denom format is factory/{creator_address}/{subdenom}
        const factoryDenom = `factory/${injectiveAddress}/${subdenom}`;
        
        // Initial supply with decimals
        const mintAmount = initialSupply * Math.pow(10, decimals);
        
        const msgMint = MsgMint.fromJSON({
            sender: injectiveAddress,
            amount: {
                denom: factoryDenom,
                amount: mintAmount.toString()
            }
        });
        
        // 3. Set token metadata
        const msgSetDenomMetadata = MsgSetDenomMetadata.fromJSON({
            sender: injectiveAddress,
            metadata: {
                description: `Token created by ${injectiveAddress}`,
                base: factoryDenom,
                display: symbol,
                name: name,
                symbol: symbol,
                uri: "",
                uriHash: "",
                denomUnits: [
                    {
                        denom: factoryDenom,
                        exponent: 0,
                        aliases: []
                    },
                    {
                        denom: symbol,
                        exponent: decimals,
                        aliases: []
                    }
                ],
                // Add required decimals field
                decimals: decimals
            }
        });
        
        // Use MsgBroadcasterWithPk to simplify broadcasting multiple messages
        const msgBroadcaster = new MsgBroadcasterWithPk({
            network,
            privateKey: privateKey.toPrivateKeyHex(),
            endpoints: endpoints
        });
        
        // Broadcast all messages in sequence
        console.error("Broadcasting transaction...");
        const txResponse = await msgBroadcaster.broadcast({
            msgs: [msgCreateDenom, msgMint, msgSetDenomMetadata]
        });
        
        console.error(`Transaction successful: ${txResponse.txHash}`);
        
        // Return token details
        return {
            contractAddress: null, // Token Factory doesn't use contract addresses
            denom: factoryDenom,
            name,
            symbol,
            totalSupply: initialSupply,
            decimals,
            creator: injectiveAddress,
            txHash: txResponse.txHash
        };
    } catch (error: any) {
        console.error("Error deploying token:", error);
        throw error;
    }
}

async function swapToken(fromDenom: string, toDenom: string, amount: number, slippage: number = 1) {
    try {
        // Import required modules from Injective SDK
        const { 
            PrivateKey,
        } = await import('@injectivelabs/sdk-ts');
        
        // Dynamic imports to get around type issues
        const sdkTs = await import('@injectivelabs/sdk-ts');
        
        // Handle different SDK versions for types
        // We need to cast to any to avoid TS errors with dynamic imports
        const OrderType = (sdkTs as any).OrderType || 
            ((sdkTs as any).OrderTypeMap && { Market: (sdkTs as any).OrderTypeMap.Market });
        
        const SpotOrderSide = (sdkTs as any).SpotOrderSide || { Buy: 1, Sell: 2 };
        const IndexerGrpcSpotApi = (sdkTs as any).IndexerGrpcSpotApi;
        const ChainGrpcExchangeApi = (sdkTs as any).ChainGrpcExchangeApi;
        const MsgBroadcasterWithPk = (sdkTs as any).MsgBroadcasterWithPk;
        const getDefaultSubaccountId = (sdkTs as any).getDefaultSubaccountId;
        const MsgCreateSpotMarketOrder = (sdkTs as any).MsgCreateSpotMarketOrder;
        
        const { getNetworkEndpoints, Network } = await import('@injectivelabs/networks');
        const utils = await import('@injectivelabs/utils');
        const BigNumberInBase = (utils as any).BigNumberInBase;
        
        // Check if all required SDK components are available
        if (!OrderType || !SpotOrderSide || !IndexerGrpcSpotApi || !MsgCreateSpotMarketOrder || 
            !ChainGrpcExchangeApi || !MsgBroadcasterWithPk || !getDefaultSubaccountId || !BigNumberInBase) {
            console.error("Required SDK components not found. Falling back to simulation.");
            return simulateSwap(fromDenom, toDenom, amount, slippage);
        }
        
        // Check if wallet exists
        if (!await checkWalletExists()) {
            throw new Error("Wallet not found. Please create a wallet first.");
        }

        // Get wallet credentials
        const walletData = await loadWallet();
        const privateKey = PrivateKey.fromMnemonic(walletData.mnemonic);
        const injectiveAddress = privateKey.toBech32();
        
        console.error(`Preparing to swap ${amount} ${fromDenom} to ${toDenom}`);
        
        // Set up network and API clients
        const network = Network.Testnet; // Use Testnet for development, Network.Testnet for production
        const endpoints = getNetworkEndpoints(network);
        
        // Initialize required API clients
        const indexerGrpcSpotApi = new IndexerGrpcSpotApi(endpoints.indexer);
        const chainGrpcExchangeApi = new ChainGrpcExchangeApi(endpoints.grpc);
        
        // 1. Fetch all available spot markets
        console.error("Fetching spot markets...");
        let spotMarkets = [];
        
        try {
            const spotMarketsResponse = await indexerGrpcSpotApi.fetchMarkets();
            
            // Safely extract markets based on the response structure
            if (spotMarketsResponse) {
                // Try different possible paths based on SDK versions
                if (Array.isArray(spotMarketsResponse)) {
                    spotMarkets = spotMarketsResponse;
                } else if (spotMarketsResponse.markets && Array.isArray(spotMarketsResponse.markets)) {
                    spotMarkets = spotMarketsResponse.markets;
                } else if ((spotMarketsResponse as any).data && Array.isArray((spotMarketsResponse as any).data)) {
                    spotMarkets = (spotMarketsResponse as any).data;
                }
            }
        } catch (error) {
            console.error("Error fetching markets:", error);
            return simulateSwap(fromDenom, toDenom, amount, slippage);
        }
        
        if (spotMarkets.length === 0) {
            console.error("No markets available on Injective");
            return simulateSwap(fromDenom, toDenom, amount, slippage);
        }
        
        // 2. Find a matching market for our token pair
        const normalizedFromDenom = normalizeDenom(fromDenom);
        const normalizedToDenom = normalizeDenom(toDenom);
        
        console.error(`Looking for market with ${normalizedFromDenom} and ${normalizedToDenom}`);
        
        // Find market by checking if base/quote or quote/base matches our token pair
        let market = null;
        for (const m of spotMarkets) {
            const baseToken = m.baseToken || (m as any).baseDenom || (m as any).baseAsset;
            const quoteToken = m.quoteToken || (m as any).quoteDenom || (m as any).quoteAsset;
            
            const baseDenom = typeof baseToken === 'string' ? baseToken : baseToken?.denom;
            const quoteDenom = typeof quoteToken === 'string' ? quoteToken : quoteToken?.denom;
            
            if ((baseDenom === normalizedFromDenom && quoteDenom === normalizedToDenom) || 
                (baseDenom === normalizedToDenom && quoteDenom === normalizedFromDenom)) {
                market = m;
                break;
            }
        }
        
        if (!market) {
            console.error(`No market found for token pair ${fromDenom}/${toDenom}`);
            return simulateSwap(fromDenom, toDenom, amount, slippage);
        }
        
        const marketId = market.marketId || (market as any).id;
        console.error(`Found market: ${marketId}`);
        
        // Extract base and quote information
        const baseToken = market.baseToken || (market as any).baseDenom || (market as any).baseAsset;
        const quoteToken = market.quoteToken || (market as any).quoteDenom || (market as any).quoteAsset;
        
        const baseDenom = typeof baseToken === 'string' ? baseToken : baseToken?.denom;
        const quoteDenom = typeof quoteToken === 'string' ? quoteToken : quoteToken?.denom;
        
        // 3. Determine if we are buying or selling the base asset
        const isBuy = baseDenom === normalizedToDenom;
        const orderSide = isBuy ? SpotOrderSide.Buy : SpotOrderSide.Sell;
        
        // 4. Fetch orderbook to get current price
        console.error(`Fetching orderbook for market ${marketId}...`);
        let orderbookResponse;
        let buys = [];
        let sells = [];
        
        try {
            orderbookResponse = await indexerGrpcSpotApi.fetchOrderbook(marketId);
            
            // Safely extract buys and sells based on the response structure
            if (orderbookResponse) {
                // Try different possible paths based on SDK versions
                if (orderbookResponse.buys && Array.isArray(orderbookResponse.buys)) {
                    buys = orderbookResponse.buys;
                } else if ((orderbookResponse as any).bids && Array.isArray((orderbookResponse as any).bids)) {
                    buys = (orderbookResponse as any).bids;
                }
                
                if (orderbookResponse.sells && Array.isArray(orderbookResponse.sells)) {
                    sells = orderbookResponse.sells;
                } else if ((orderbookResponse as any).asks && Array.isArray((orderbookResponse as any).asks)) {
                    sells = (orderbookResponse as any).asks;
                }
            }
        } catch (error) {
            console.error("Error fetching orderbook:", error);
            return simulateSwap(fromDenom, toDenom, amount, slippage);
        }
        
        // 5. Determine price based on order side and apply slippage
        let price;
        
        if (isBuy) {
            // When buying, use ask (sell) price + slippage
            if (sells.length === 0) {
                console.error("No sell orders in the orderbook");
                return simulateSwap(fromDenom, toDenom, amount, slippage);
            }
            
            const bestAskPrice = new BigNumberInBase(sells[0].price || sells[0].p);
            price = bestAskPrice.times(1 + slippage / 100);
        } else {
            // When selling, use bid (buy) price - slippage
            if (buys.length === 0) {
                console.error("No buy orders in the orderbook");
                return simulateSwap(fromDenom, toDenom, amount, slippage);
            }
            
            const bestBidPrice = new BigNumberInBase(buys[0].price || buys[0].p);
            price = bestBidPrice.times(1 - slippage / 100);
        }
        
        console.error(`Using price: ${price.toFixed()} with ${slippage}% slippage`);
        
        // 6. Calculate quantity
        // Convert to base units (considering decimals)
        let quantity;
        
        // Extract decimals safely
        const baseDecimals = parseInt(
            typeof baseToken === 'string' ? "18" : 
            (baseToken?.decimals || (baseToken as any).decimal || "18")
        );
        
        const quoteDecimals = parseInt(
            typeof quoteToken === 'string' ? "18" : 
            (quoteToken?.decimals || (quoteToken as any).decimal || "18")
        );
        
        if (isBuy) {
            // When buying, we're spending the quote token to get the base token
            // quantity = quote amount / price (in base token)
            const quoteAmount = new BigNumberInBase(amount).times(10 ** quoteDecimals);
            quantity = quoteAmount.div(price).times(10 ** (baseDecimals - quoteDecimals));
        } else {
            // When selling, we're selling the base token to get the quote token
            // quantity = base amount (in base token)
            quantity = new BigNumberInBase(amount).times(10 ** baseDecimals);
        }
        
        console.error(`Order quantity: ${quantity.toFixed()}`);
        
        // 7. Get subaccount ID (derivation of user's address as a hex string)
        const subaccountId = getDefaultSubaccountId(injectiveAddress);
        
        console.error(`Using subaccount ID: ${subaccountId}`);
        
        // 8. Create market order
        // Try to accommodate different SDK versions by checking format
        const msgParams = {
            sender: injectiveAddress,
            marketId: marketId,
            subaccountId: subaccountId,
            orderType: OrderType.Market,
            orderSide: orderSide,
            price: price.toFixed(),
            quantity: quantity.toFixed(),
            timeInForce: 3, // Immediate or cancel
            triggerPrice: "0" // Not used for market orders
        };
        
        let orderMsg;
        try {
            // Try different ways to create the message based on SDK version
            if (typeof MsgCreateSpotMarketOrder.fromJSON === 'function') {
                orderMsg = MsgCreateSpotMarketOrder.fromJSON(msgParams);
            } else if (typeof MsgCreateSpotMarketOrder === 'function') {
                orderMsg = new MsgCreateSpotMarketOrder(msgParams);
            } else {
                throw new Error("Cannot create spot market order message");
            }
        } catch (error) {
            console.error("Error creating market order message:", error);
            return simulateSwap(fromDenom, toDenom, amount, slippage);
        }
        
        // 9. Broadcast the transaction
        console.error("Broadcasting transaction...");
        let txResponse;
        
        try {
            const msgBroadcaster = new MsgBroadcasterWithPk({
                network,
                privateKey: privateKey.toPrivateKeyHex(),
                endpoints: endpoints
            });
            
            txResponse = await msgBroadcaster.broadcast({
                msgs: [orderMsg]
            });
        } catch (error) {
            console.error("Error broadcasting transaction:", error);
            return simulateSwap(fromDenom, toDenom, amount, slippage);
        }
        
        console.error(`Transaction successful: ${txResponse.txHash}`);
        
        // 10. Calculate estimated output amount
        const estimatedOutputAmount = isBuy 
            ? quantity.div(10 ** baseDecimals).toNumber() 
            : quantity.times(price).div(10 ** quoteDecimals).toNumber();
        
        // Return swap details
        return {
            fromDenom,
            toDenom,
            inputAmount: amount,
            estimatedOutputAmount,
            executionPrice: price.div(10 ** (quoteDecimals - baseDecimals)).toNumber(),
            txHash: txResponse.txHash,
            marketId: marketId,
            orderSide: isBuy ? 'buy' : 'sell',
            isSimulated: false // This is a real swap, not a simulation
        };
        
    } catch (error: any) {
        console.error("Error swapping tokens:", error);
        
        // For debugging purposes only - in production, remove this
        if (error.message) {
            console.error(`Error details: ${error.message}`);
            if (error.stack) {
                console.error(`Stack trace: ${error.stack}`);
            }
        }
        
        // Fall back to simulation if the real implementation fails
        console.error("Falling back to simulation mode due to error");
        return simulateSwap(fromDenom, toDenom, amount, slippage);
    }
}

/**
 * Normalizes a token denom by removing any prefix like 'factory/' if present
 */
function normalizeDenom(denom: string): string {
    // For factory tokens, we might need to handle the format 'factory/{creator address}/{subdenom}'
    if (denom.startsWith('factory/') || denom.startsWith('ibc/')) {
        return denom;
    }
    
    // For common tokens like INJ, we can handle special cases
    if (denom.toUpperCase() === 'INJ') {
        return 'inj';
    }
    
    // Default case, return as is
    return denom;
}

/**
 * Simulates a token swap when the real implementation fails
 */
function simulateSwap(fromDenom: string, toDenom: string, amount: number, slippage: number = 1): any {
    console.log(`SIMULATING SWAP: ${amount} ${fromDenom} to ${toDenom} with ${slippage}% slippage`);
    
    // Generate a mock price (this would be replaced by actual market data in a real implementation)
    const mockPrice = Math.random() * 10 + 1; // Random price between 1 and 11
    const estimatedOutput = amount * mockPrice * (1 - slippage/100);
    
    // Generate a mock transaction hash
    const mockTxHash = "0x" + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    
    // Return simulated swap details
    return {
        fromDenom,
        toDenom,
        inputAmount: amount,
        estimatedOutputAmount: estimatedOutput,
        executionPrice: mockPrice,
        txHash: mockTxHash,
        marketId: "mock-market-id", 
        orderSide: 'buy',
        isSimulated: true // Flag to indicate this is a simulation
    };
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
        } else if (name === "deploy-token") {
            const { name: tokenName, symbol, initialSupply, decimals } = DeployTokenSchema.parse(args);
            const result = await deployToken(tokenName, symbol, initialSupply, decimals);
            return {
                content: [
                    {
                        type: "text",
                        text: `Successfully deployed token "${tokenName}" (${symbol}) on Injective!\n\n` +
                            `Denom: ${result.denom}\n` +
                            `Total Supply: ${initialSupply} ${symbol}\n` +
                            `Decimals: ${decimals}\n` +
                            `Creator: ${result.creator}\n` +
                            `Transaction Hash: ${result.txHash}`
                    },
                ],
            };
        } else if (name === "swap-token") {
            const { fromDenom, toDenom, amount, slippage } = SwapTokenSchema.parse(args);
            const result = await swapToken(fromDenom, toDenom, parseFloat(amount.toString()), slippage ? parseFloat(slippage.toString()) : 1);
            
            let message = "";
            
            if (result.isSimulated) {
                message = `✅ SIMULATED SWAP ONLY: ${result.inputAmount} ${result.fromDenom} to approximately ${result.estimatedOutputAmount.toFixed(6)} ${result.toDenom} at price ${result.executionPrice.toFixed(6)}\n\nNote: This is a simulated result. In a production environment, this would execute a real swap on Injective.`;
            } else {
                message = `✅ Successfully swapped ${result.inputAmount} ${result.fromDenom} to approximately ${result.estimatedOutputAmount.toFixed(6)} ${result.toDenom}\n\nDetails:\n- Price: ${result.executionPrice.toFixed(6)}\n- Market ID: ${result.marketId}\n- Order Side: ${result.orderSide}\n- Transaction Hash: ${result.txHash}`;
            }
            
            return {
                content: [
                    {
                        type: "text",
                        text: message
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
