/* eslint-disable @typescript-eslint/no-var-requires */
const express = require('express')
const path = require('path')
const home = path.join(__dirname, '/public')
const app = express()
app.use(express.static(home))
app.use('/dist', express.static(__dirname + '/dist'))

const tryListen = (port) => {
  const server = app.listen(port)
    .on('listening', () => console.log(`⚡ http://localhost:${port}`))
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < 8010) {
        tryListen(port + 1)
      } else {
        console.error(`Failed to start server: ${err.message}`)
      }
    })
}

tryListen(8000)
