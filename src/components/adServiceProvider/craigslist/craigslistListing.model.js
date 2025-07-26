const mongoose = require('mongoose')

// Define the Mongoose schema for Craigslist listings
const craigslistListingSchema = new mongoose.Schema({
    listingPid: { type: Number },
    json: String
}).index({ listingPid: 1 })

module.exports = mongoose.model('craigslist_ad', craigslistListingSchema)
