const express = require('express');
const router = express.Router();
const occupancyEvents = require('../services/occupancyEmitter');

router.get('/live', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send an initial connected message
  res.write('data: {"status":"connected"}\n\n');

  // Define the listener for occupancy updates
  const updateListener = (data) => {
    // Check if client is listening for a specific library
    const libraryId = req.query.libraryId || req.query.libraryCode;
    if (libraryId && (data.libraryId !== libraryId && data.libraryCode !== libraryId)) {
      return;
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Subscribe to the event
  occupancyEvents.on('occupancyUpdated', updateListener);

  // Clean up when client disconnects
  req.on('close', () => {
    occupancyEvents.removeListener('occupancyUpdated', updateListener);
    res.end();
  });
});

module.exports = router;
