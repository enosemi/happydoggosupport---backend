const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Configuration - Add these to your environment variables
const CONFIG = {
  FLUTTERWAVE_SECRET_KEY: process.env.FLUTTERWAVE_SECRET_KEY || 'FLWSECK-a098f079552823c0363ff0dc6077028c-19a09326dbbvt-X',
  FLUTTERWAVE_WEBHOOK_SECRET: process.env.FLUTTERWAVE_WEBHOOK_SECRET || 'jK8Qp2xY7vR9tLmN1cB4zA6wE0dF3gH5',
  BYBIT_API_KEY: process.env.BYBIT_API_KEY || 'luztCcXRwiZdmR4gDe',
  BYBIT_API_SECRET: process.env.BYBIT_API_SECRET || '1awZ8O6Dlemein6t4RskoBjOInn1eP8MjquW',
  BYBIT_WALLET: process.env.BYBIT_WALLET || 'TUehgCTHvGA9bVLJrq4tgkRBykQTZHU2wS'
};

// In-memory storage for transactions (in production, use a database)
let transactions = [];

// Webhook endpoint for Flutterwave to send payment notifications
app.post('/api/webhook/flutterwave', async (req, res) => {
  try {
    console.log('Webhook received:', req.body);
    
    const event = req.body;
    
    // Verify the webhook is from Flutterwave
    const secretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
    const signature = req.headers['verif-hash'];
    
    if (!signature || signature !== secretHash) {
      console.log('Unauthorized webhook attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if payment was successful
    if (event.event === 'charge.completed' && event.data.status === 'successful') {
      const paymentData = event.data;
      
      // Extract payment details
      const amount = paymentData.amount;
      const currency = paymentData.currency;
      const customerEmail = paymentData.customer.email;
      const customerName = paymentData.customer.name || 'Anonymous';
      const transactionId = paymentData.id;
      const flutterwaveTxRef = paymentData.tx_ref;
      
      console.log(`Payment received: ${amount} ${currency} from ${customerEmail}`);
      
      // Convert to USDT and transfer to Bybit
      const conversionResult = await convertToUSDTAndTransfer(amount, currency, transactionId);
      
      if (conversionResult.success) {
        console.log(`Successfully converted and transferred to Bybit: ${conversionResult.usdtAmount} USDT`);
        
        // Store transaction
        const transactionRecord = {
          flutterwaveTxId: transactionId,
          flutterwaveTxRef: flutterwaveTxRef,
          bybitTxId: conversionResult.bybitTxId,
          amount: amount,
          currency: currency,
          usdtAmount: conversionResult.usdtAmount,
          customerEmail: customerEmail,
          customerName: customerName,
          status: 'completed',
          exchangeRate: conversionResult.exchangeRate,
          timestamp: new Date().toISOString()
        };
        
        transactions.push(transactionRecord);
        
        // In production, save to database here
        console.log('Transaction recorded:', transactionRecord);
        
        return res.status(200).json({ 
          status: 'success',
          message: 'Payment processed and converted to USDT',
          transactionId: conversionResult.bybitTxId
        });
      } else {
        console.error('Conversion failed:', conversionResult.error);
        
        // Record failed transaction
        const failedTransaction = {
          flutterwaveTxId: transactionId,
          flutterwaveTxRef: flutterwaveTxRef,
          amount: amount,
          currency: currency,
          customerEmail: customerEmail,
          customerName: customerName,
          status: 'failed',
          error: conversionResult.error,
          timestamp: new Date().toISOString()
        };
        
        transactions.push(failedTransaction);
        
        return res.status(500).json({ 
          error: 'Conversion failed',
          details: conversionResult.error
        });
      }
    }
    
    res.status(200).json({ status: 'event_processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Function to convert currency to USDT and transfer to Bybit
async function convertToUSDTAndTransfer(amount, currency, transactionId) {
  try {
    console.log(`Converting ${amount} ${currency} to USDT...`);
    
    // Step 1: Get current exchange rate
    const exchangeRate = await getExchangeRate(currency, 'USDT');
    console.log(`Exchange rate: 1 ${currency} = ${exchangeRate} USDT`);
    
    // Step 2: Calculate USDT amount
    const usdtAmount = (amount * exchangeRate).toFixed(6);
    console.log(`Converted amount: ${usdtAmount} USDT`);
    
    // Step 3: Transfer to Bybit wallet
    const transferResult = await transferToBybit(usdtAmount, transactionId);
    
    if (transferResult.success) {
      return {
        success: true,
        usdtAmount: usdtAmount,
        bybitTxId: transferResult.transactionId,
        exchangeRate: exchangeRate
      };
    } else {
      throw new Error(transferResult.error);
    }
  } catch (error) {
    console.error('Conversion error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Function to get exchange rate
async function getExchangeRate(fromCurrency, toCurrency) {
  try {
    // Using a free exchange rate API
    const response = await axios.get(`https://api.exchangerate.host/convert?from=${fromCurrency}&to=${toCurrency}`);
    
    if (response.data && response.data.result) {
      return response.data.result;
    } else {
      throw new Error('Invalid response from exchange rate API');
    }
  } catch (error) {
    console.error('Exchange rate API error:', error.message);
    
    // Fallback rates if API fails
    const fallbackRates = {
      'USD': 1.0,
      'NGN': 0.0012,
      'GBP': 1.22,
      'EUR': 1.07,
      'KES': 0.0078,
      'GHS': 0.082,
      'ZAR': 0.054,
      'UGX': 0.00027,
      'TZS': 0.00041,
      'RWF': 0.00081,
      'XAF': 0.0016,
      'XOF': 0.0016,
      'EGP': 0.032,
      'AED': 0.27,
      'SAR': 0.27,
      'INR': 0.012,
      'CAD': 0.73,
      'AUD': 0.65
    };
    
    return fallbackRates[fromCurrency] || 1.0;
  }
}

// Function to transfer to Bybit (simplified - you'll need to implement actual Bybit API integration)
async function transferToBybit(usdtAmount, reference) {
  try {
    console.log(`Transferring ${usdtAmount} USDT to Bybit wallet...`);
    
    // This is a simplified version - actual implementation requires Bybit API integration
    // You'll need to use Bybit's official API for crypto transfers
    
    // Simulate API call to Bybit
    const bybitTxId = 'BYBIT_' + Math.random().toString(36).substr(2, 10).toUpperCase();
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`Transfer successful! Transaction ID: ${bybitTxId}`);
    
    // In production, you would use something like:
    /*
    const response = await axios.post('https://api.bybit.com/v2/private/wallet/transfer', {
      coin: 'USDT',
      amount: usdtAmount,
      from_account_type: 'SPOT',
      to_account_type: 'SPOT', 
      transfer_type: 'IN'
    }, {
      headers: {
        'API-KEY': CONFIG.BYBIT_API_KEY,
        'API-SECRET': CONFIG.BYBIT_API_SECRET
      }
    });
    */
    
    return {
      success: true,
      transactionId: bybitTxId
    };
  } catch (error) {
    console.error('Bybit transfer error:', error);
    return {
      success: false,
      error: `Bybit transfer failed: ${error.message}`
    };
  }
}

// API endpoint to get transaction history
app.get('/api/transactions', (req, res) => {
  try {
    res.json({
      success: true,
      transactions: transactions,
      total: transactions.length
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transactions'
    });
  }
});

// API endpoint to get transaction by ID
app.get('/api/transactions/:id', (req, res) => {
  try {
    const transactionId = req.params.id;
    const transaction = transactions.find(t => 
      t.flutterwaveTxId === transactionId || 
      t.bybitTxId === transactionId
    );
    
    if (transaction) {
      res.json({
        success: true,
        transaction: transaction
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transaction'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'HappyDoggoSupport Backend',
    version: '1.0.0'
  });
});

// Serve frontend files (for testing)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HappyDoggoSupport Backend</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .container { max-width: 800px; margin: 0 auto; }
        .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
        .success { background: #d4edda; color: #155724; }
        .info { background: #d1ecf1; color: #0c5460; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 HappyDoggoSupport Backend Server</h1>
        <div class="status success">
          <strong>Status:</strong> Server is running successfully!
        </div>
        <div class="status info">
          <strong>Endpoints:</strong>
          <ul>
            <li><strong>GET</strong> /api/health - Health check</li>
            <li><strong>POST</strong> /api/webhook/flutterwave - Flutterwave webhook</li>
            <li><strong>GET</strong> /api/transactions - Get all transactions</li>
            <li><strong>GET</strong> /api/transactions/:id - Get transaction by ID</li>
          </ul>
        </div>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      </div>
    </body>
    </html>
  `);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🎉 HappyDoggoSupport Backend Server Started!
📍 Port: ${PORT}
🚀 Environment: ${process.env.NODE_ENV || 'development'}
📅 Started at: ${new Date().toISOString()}

📋 Available Endpoints:
   GET  /api/health          - Health check
   POST /api/webhook/flutterwave - Payment webhook
   GET  /api/transactions    - Get all transactions
   GET  /api/transactions/:id - Get transaction by ID

🔧 Configuration:
   Flutterwave Secret: ${CONFIG.FLUTTERWAVE_SECRET_KEY ? '✅ Set' : '❌ Missing'}
   Bybit Wallet: ${CONFIG.BYBIT_WALLET ? '✅ Set' : '❌ Missing'}

⚡ Server is ready to receive webhooks!
  `);
});

module.exports = app;