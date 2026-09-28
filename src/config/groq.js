const dotenv = require('dotenv');
dotenv.config();

const Groq = require("groq-sdk");

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  throw new Error("GROQ_API_KEY is not configured");
}

const groq = new Groq({
  apiKey,
});

module.exports = groq;
module.exports.groq = groq;
