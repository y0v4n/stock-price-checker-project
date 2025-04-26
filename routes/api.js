'use strict';

const mongoose = require('mongoose');
const fetch = require('node-fetch');
const crypto = require('crypto');
const hashIP = (ip) => {
  return crypto.createHash('sha256').update(ip).digest('hex');
};

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// MongoDB Model
const stockSchema = new mongoose.Schema({
  stock: { type: String, required: true },
  likes: { type: Number, default: 0 },
  ips: [String] // To track IP addresses that liked
});
const Stock = mongoose.model('Stock', stockSchema);

// Function to fetch stock price (Example API: https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/{symbol}/quote)
async function getStockPrice(stockSymbol) {
  const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${stockSymbol}/quote`;

  const response = await fetch(url);
  const data = await response.json();
  if (!data || !data.latestPrice) {
    throw new Error('Invalid stock data');
  }
  return data.latestPrice;
}

module.exports = function (app) {

  app.route('/api/stock-prices')
    .get(async function (req, res) {
      try {
        const { stock, like } = req.query;
        const userIP = hashIP(req.ip);

        // Helper to handle single stock logic
        const processStock = async (stockSymbol) => {
          const stockSymbolUpper = stockSymbol.toUpperCase();
          const price = await getStockPrice(stockSymbolUpper);

          let stockDoc = await Stock.findOne({ stock: stockSymbolUpper });

          if (!stockDoc) {
            stockDoc = new Stock({ stock: stockSymbolUpper });
          }

          // Handle like logic
          if (like === 'true' && !stockDoc.ips.includes(userIP)) {
            stockDoc.likes += 1;
            stockDoc.ips.push(userIP);
            await stockDoc.save();
          }

          return {
            stock: stockSymbolUpper,
            price,
            likes: stockDoc.likes
          };
        };

        // Handle multiple stocks (array) or single stock (string)
        if (Array.isArray(stock)) {
          const stockData = await Promise.all(stock.map(s => processStock(s)));

          const rel_likes = stockData.map((s, i) => {
            const otherIndex = i === 0 ? 1 : 0;
            return s.likes - stockData[otherIndex].likes;
          });

          const responseObj = {
            stockData: stockData.map((s, i) => ({
              stock: s.stock,
              price: s.price,
              rel_likes: rel_likes[i]
            }))
          };

          res.json(responseObj);
        } else {
          const stockData = await processStock(stock);

          res.json({
            stockData
          });
        }

      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
};