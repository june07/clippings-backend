const mongoose = require('mongoose')

// Define the Mongoose schema for Craigslist listings
const craigslistListingSchema = new mongoose.Schema({
    createdAt: Date,
    listingPid: { type: Number, unique: true },
    metadata: String
}).index({ listingPid: 1 })

module.exports = mongoose.model('craigslist_ad', craigslistListingSchema)
