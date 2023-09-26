module.exports = function(relativeTime) {
    if (!relativeTime) return
    // Check for "N h ago" format
    const hoursAgoMatch = relativeTime.match(/^(\d+)\s*h\s+ago$/)
    if (hoursAgoMatch) {
        const hoursAgo = parseInt(hoursAgoMatch[1], 10)
        const currentTimestamp = Math.floor(Date.now() / 1000) // Current Unix timestamp in seconds
        const estimatedTimestamp = currentTimestamp - hoursAgo * 3600 // Subtract hours in seconds
        return estimatedTimestamp
    }

    const minutessAgoMatch = relativeTime.match(/^(\d+)\s*mins\s+ago$/)
    if (minutessAgoMatch) {
        const minutessAgo = parseInt(minutessAgoMatch[1], 10)
        const currentTimestamp = Math.floor(Date.now() / 1000) // Current Unix timestamp in seconds
        const estimatedTimestamp = currentTimestamp - minutessAgo * 60 // Subtract hours in seconds
        return estimatedTimestamp
    }

    // Check for "M/D" format (month/day)
    const dateMatch = relativeTime.match(/^(\d+)\/(\d+)$/)
    if (dateMatch) {
        const month = parseInt(dateMatch[1], 10)
        const day = parseInt(dateMatch[2], 10)

        // Assuming the year is the current year
        const currentYear = new Date().getFullYear()
        const estimatedTimestamp = Math.floor(
            new Date(currentYear, month - 1, day).getTime() / 1000
        ) // Convert to Unix timestamp
        return estimatedTimestamp
    }

    return null // Return null if the format doesn't match
}