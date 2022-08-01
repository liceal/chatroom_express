//? 引入本体 后面()执行方法，默认监听端口为服务本身
var io = require("socket.io")();
var fs = require("fs");
var moment = require("moment");
var historyList = [];
var historyLength = 10; //? 历史记录保存条数

//? 正常使用即可
console.log("connected");
io.on("connection", function (socket) {
  console.log("连接成功");

  // console.log(rooms);
  const rooms = roomsArray(socket);

  //* 连接成功
  socket.emit("connected", {
    msg: `${socket.id} 连接成功⭕`,
    rooms: rooms,
    historyList: historyList,
    _id: socket.id,
  });

  //* 广播所有房间信息
  socket.broadcast.emit("rooms", {
    rooms: rooms,
    historyList: historyList,
    _id: socket.id,
  });

  //* 广播所有附件地址
  sendAllFiles(socket);

  //* 有人文件上传成功或者文件被删除时候，广播所有用户刷新当前资源列表
  socket.on("file-upload-change", (data) => {
    // console.log('有人文件上传成功', '上传成功的文件:', data);
    // socket.broadcast.emit('fileList')
    //读取所有资源文件
    sendAllFiles(socket, data);
  });

  //* 图片base64
  socket.on("image", (data) => {
    //广播发送给其他人
    if (historyList.length >= historyLength) {
      historyList.shift();
    }
    historyList.push({
      msg: data.file,
      type: 1,
    });
    socket.broadcast.emit("image", data);
  });

  //* 广播消息
  socket.on("message", (msg) => {
    console.log("收到客户端的消息：", msg);
    //对收到的消息进行正则匹配，过滤掉敏感字
    let repalce2Msg = {
      傻逼: "天才",
      废物: "圣物",
      你妈: "我妈",
      尼玛: "我妈",
      丑逼: "帅哥",
      "[傻逼爸爹儿]": "*",
    };
    Object.keys(repalce2Msg).forEach((v) => {
      msg = msg.replace(new RegExp(v, "g"), repalce2Msg[v]);
    });
    //? 加入historyList 最多保存十条消息
    if (historyList.length >= historyLength) {
      historyList.shift();
    }
    historyList.push({
      msg: msg,
      type: 0,
    });
    let sendMsg = {
      msg: msg,
      _id: socket.id,
    };

    socket.emit("message", sendMsg);
    //广播发送消息 除了自己
    socket.broadcast.emit("message", sendMsg);
  });

  //* 断开连接
  socket.on("disconnect", function (msg) {
    // console.log('断开连接', socket);
    socket.broadcast.emit("disconneted", {
      rooms: roomsArray(socket),
      _id: socket.id,
    });
  });

  //* 清空历史记录
  socket.on("clearHistory", (data) => {
    //点击清空聊天的人ID
    console.log("清空聊天记录人的ID:", socket.id);
    historyList = [];
  });
});

// 其他项目
require("./simple-peer.js")(io);

//* 当前连接者，参数socket实例
function roomsArray(socket) {
  return [...socket.adapter.rooms].map((v) => {
    return v[0];
  });
}

//* 读取资源文件列表并且广播给所有人，包括自己
function sendAllFiles(socket, nowUploadFile = null) {
  fs.readdir(__dirname + "/../public/file", (err, files) => {
    //? 获取资源文件，排除.开头的资源 比如.gitkeep
    let fileList = files
      .filter((v) => v[0] !== ".")
      .map((v) => {
        return {
          path: `/file/${v}`,
          name: v.split("--")[1],
          date: moment(Number(v.split("--")[0])).format("YYYY-MM-DD HH:mm:ss"),
          originalname: v,
        };
      });
    let data = {
      nowUploadFile: nowUploadFile,
      fileList: fileList,
    };
    //广播给所有人最新的资源列表 包括自己
    socket.emit("file-list-paths", data);
    socket.broadcast.emit("file-list-paths", data);
  });
}

//? 抛出listen去改变监听服务
exports.listen = function (server) {
  io.listen(server);
};
