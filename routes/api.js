'use strict';

const mongoose = require('mongoose');
const fetch = require('node-fetch');
const crypto = require('crypto');

// Function to hash IP addresses for privacy
const hashIP = (ip) => {
  return crypto.createHash('sha256').update(ip).digest('hex');
};

// Function to normalize IP addresses (handles IPv6-mapped IPv4)
const getNormalizedIP = (req) => {
  const ip = req.ip || req.connection.remoteAddress;
  return ip.includes('::ffff:') ? ip.split('::ffff:')[1] : ip;
};

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Define MongoDB schema and model
const stockSchema = new mongoose.Schema({
  stock: { type: String, required: true },
  likes: { type: Number, default: 0 },
  ips: [String]
});
const Stock = mongoose.model('Stock', stockSchema);

// Function to fetch stock price from FCC proxy API
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
        let { stock, like } = req.query;

        // Normalize like parameter
        like = like === 'true' || like === '1' || like === 1 || like === true;

        const normalizedIP = getNormalizedIP(req);
        const userIP = hashIP(normalizedIP);

        // Function to process individual stock
        const processStock = async (stockSymbol) => {
          const stockSymbolUpper = stockSymbol.toUpperCase();
          const price = await getStockPrice(stockSymbolUpper);

          let stockDoc = await Stock.findOne({ stock: stockSymbolUpper });
          if (!stockDoc) {
            stockDoc = new Stock({ stock: stockSymbolUpper });
          }

          // Handle like logic
          if (like && !stockDoc.ips.includes(userIP)) {
            stockDoc.likes += 1;
            stockDoc.ips.push(userIP);
          }

          await stockDoc.save(); // Always save to ensure stock/IP persistence

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

          res.json({
            stockData: stockData.map((s, i) => ({
              stock: s.stock,
              price: s.price,
              rel_likes: rel_likes[i]
            }))
          });
        } else {
          const stockData = await processStock(stock);
          res.json({ stockData });
        }

      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

};
