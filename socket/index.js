//? 引入本体 后面()执行方法，默认监听端口为服务本身
var io = require('socket.io')()

//? 正常使用即可
console.log('connected');
io.on('connection', function (socket) {

  console.log('连接成功');

  // console.log(rooms);
  const rooms = roomsArray(socket);

  //* 连接成功
  socket.emit('connected', {
    msg: `${socket.id} 连接成功⭕`,
    rooms: rooms,
    _id: socket.id
  })

  //* 广播所有房间信息
  socket.broadcast.emit('rooms', {
    rooms: rooms,
    _id: socket.id
  })

  //* 资源文件
  socket.on('file', (data) => {
    //广播发送给其他人
    socket.broadcast.emit('file', data)
  })

  //* 广播消息
  socket.on('message', (msg) => {
    console.log('收到客户端的消息：', msg);
    //对收到的消息进行正则匹配，过滤掉敏感字
    let repalce2Msg = {
      '傻逼': '天才',
      '废物': '圣物',
      '你妈': '我妈',
      '尼玛': '我妈',
      '丑逼': '帅哥',
      '[傻逼爸爹儿]': '*'
    }
    Object.keys(repalce2Msg).forEach(v => {
      msg = msg.replace(new RegExp(v, 'g'), repalce2Msg[v])
    })
    let sendMsg = {
      msg: msg,
      _id: socket.id
    }

    socket.emit('message', sendMsg)
    //广播发送消息 除了自己
    socket.broadcast.emit('message', sendMsg)
  })

  //* 断开连接
  socket.on('disconnect', function (msg) {
    // console.log('断开连接', socket);
    socket.broadcast.emit('disconneted', {
      rooms: roomsArray(socket),
      _id: socket.id
    })
  })
})

//当前连接者，参数socket实例
function roomsArray(socket) {
  return [...socket.adapter.rooms].map((v) => {
    return v[0]
  })
}

//? 抛出listen去改变监听服务
exports.listen = function (server) {
  io.listen(server)
}