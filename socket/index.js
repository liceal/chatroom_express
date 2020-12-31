//? 引入本体 后面()执行方法，默认监听端口为服务本身
var io = require('socket.io')()
var fs = require('fs')
var moment = require('moment')

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

  //* 广播所有附件地址
  // sendAllFiles(socket)

  //* 有人文件上传成功或者文件被删除时候，广播所有用户刷新当前资源列表
  socket.on('file-upload-change', (data) => {
    // console.log('有人文件上传成功', '上传成功的文件:', data);
    // socket.broadcast.emit('fileList')
    //读取所有资源文件
    sendAllFiles(socket, data)
  })

  //* 图片base64
  socket.on('image', (data) => {
    //广播发送给其他人
    socket.broadcast.emit('image', data)
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

//* 当前连接者，参数socket实例
function roomsArray(socket) {
  return [...socket.adapter.rooms].map((v) => {
    return v[0]
  })
}

//* 读取资源文件列表并且广播给所有人，包括自己
function sendAllFiles(socket, nowUploadFile = null) {
  fs.readdir('public/file', (err, files) => {
    let fileList = files.map(v => {
      return {
        path: `/file/${v}`,
        name: v.split('--')[1],
        date: moment(Number(v.split('--')[0])).format('YYYY-MM-DD HH:mm:ss'),
        originalname: v
      }
    })
    let data = {
      nowUploadFile: nowUploadFile,
      fileList: fileList,
    }
    //广播给所有人最新的资源列表 包括自己
    socket.emit('file-list-paths', data)
    socket.broadcast.emit('file-list-paths', data)
  })
}

//? 抛出listen去改变监听服务
exports.listen = function (server) {
  io.listen(server)
}