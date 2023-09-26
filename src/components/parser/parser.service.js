const debug = require('debug')(`jc:parser:service`)
const cheerio = require('cheerio')

const { estimateTimestampFromRelativeTime } = require('../../utils')

const parse = async (payload) => {
    const { url, uuid, html } = payload
    const $ = cheerio.load(html)
    const $searchResults = $('li.cl-search-result')
    let json = {
        url,
        uuid,
        listings: {}
    }
    let cached = await redis.GET(`cl-json-${uuid}`)
    let diff = cached ? true : false

    $searchResults.each((_index, element) => {
        const pid = $(element).attr('data-pid')
        const href = $(element).find('.posting-title').attr('href')
        const title = $(element).find('.cl-app-anchor .label').text()
        const meta = $(element).find('.meta').text().split($(element).find('.separator').text())

        if (!pid || !title) return
        if (!json.listings[pid]) {
            json.listings[pid] = {
                pid,
                imageUrls: []
            }
        }

        $(element).find('.gallery-inner img').each((_index, element) => {
            const imageUrl = $(element).attr('src')
            if (imageUrl) {
                json.listings[pid].imageUrls = Array.from(new Set([...json.listings[pid].imageUrls, imageUrl]))
            }
        })
        json.listings[pid].href = href
        json.listings[pid].title = title
        json.listings[pid].meta = meta
        json.listings[pid].time = estimateTimestampFromRelativeTime(json.listings[pid].meta[0])
    })
    json.updatedAt = Date.now()

    if (diff) {
        cached = JSON.parse(cached)
        const newListings = Object.keys(json.listings).filter(key => !cached.listings[key]).reduce((listings, key) => ({ ...listings, [key]: json.listings[key] }), {})

        console.log('newListings: ', newListings)
        if (JSON.stringify(newListings) !== '{}') {
            const multi = redis.multi()
            const diff = {
                ...json,
                updatedAt: Date.now(),
                listings: newListings
            }

            multi.SET(`cl-json-${uuid}`, JSON.stringify({
                ...cached,
                ...json
            }))
            multi.SET(`cl-json-diff-${uuid}`, JSON.stringify(diff))
            multi.exec()
            return { json, diff }
        }
    } else {
        redis.SET(`cl-json-${uuid}`, JSON.stringify(json))
        return { json }
    }
    return {}
}

module.exports = {
    parse
}