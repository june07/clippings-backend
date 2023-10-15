const mongoose = require('mongoose')

const contactSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    name: String,
    email: String,
    phone: String,
    relationship: String
}).index({ id: 1 })

module.exports = mongoose.model('Contact', contactSchema)
