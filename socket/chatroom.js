var io = require('socket.io')

exports.listen = function (server) {
  io.listen(server)
}