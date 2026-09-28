const EventEmitter = require('events');
const occupancyEvents = new EventEmitter();
occupancyEvents.setMaxListeners(100);

module.exports = occupancyEvents;
