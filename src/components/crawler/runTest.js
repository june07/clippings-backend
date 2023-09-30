import test from './test.js'

const url = process.argv[2]

try {
    process.stdout.write(JSON.stringify(await test(url)))
} catch (error) {
    console.error(error)
}