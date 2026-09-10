//? 引入本体 后面()执行方法，默认监听端口为服务本身
var io = require("socket.io")();
var fs = require("fs");
var path = require("path");
var moment = require("moment");
var historyList = [];
var historyLength = 20; //? 历史记录保存条数扩展为20条

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

console.log("Socket.IO 服务器端只读服务就绪");
io.on("connection", function (socket) {
  console.log("客户端连接:", socket.id);

  const rooms = roomsArray();

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
    sendAllFiles(socket, data);
  });

  //* 图片base64
  socket.on("image", (data) => {
    if (historyList.length >= historyLength) {
      historyList.shift();
    }
    historyList.push({
      msg: data.file,
      type: 1,
      sender: socket.id,
      time: moment().format("HH:mm:ss")
    });
    socket.broadcast.emit("image", {
      file: data.file,
      _id: socket.id,
      time: moment().format("HH:mm:ss")
    });
  });

  //* 广播消息
  socket.on("message", (msg) => {
    if (!msg || typeof msg !== "string" || !msg.trim()) return;
    
    // 对收到的消息进行正则匹配，过滤掉敏感字
    let repalce2Msg = {
      傻逼: "天才",
      废物: "圣物",
      你妈: "我妈",
      尼玛: "我妈",
      丑逼: "帅哥",
    };
    Object.keys(repalce2Msg).forEach((v) => {
      msg = msg.replace(new RegExp(escapeRegExp(v), "g"), repalce2Msg[v]);
    });
    
    let timeStr = moment().format("HH:mm:ss");
    let msgObj = {
      msg: msg,
      _id: socket.id,
      time: timeStr
    };

    if (historyList.length >= historyLength) {
      historyList.shift();
    }
    historyList.push({
      msg: msg,
      type: 0,
      sender: socket.id,
      time: timeStr
    });

    socket.emit("message", msgObj);
    socket.broadcast.emit("message", msgObj);
  });

  //* 断开连接
  socket.on("disconnect", function () {
    console.log("客户端断开连接:", socket.id);
    socket.broadcast.emit("disconneted", {
      rooms: roomsArray(),
      _id: socket.id,
    });
  });

  //* WebRTC P2P 信令中继
  socket.on("rtc-signal", (data) => {
    if (!data || !data.type) return;
    if (data.targetId) {
      // 点对点定向转发 (Offer, Answer, ICE Candidate)
      io.to(data.targetId).emit("rtc-signal", {
        ...data,
        senderId: socket.id
      });
    } else {
      // 广播消息 (加入频道, 离开频道, 查询列表)
      socket.broadcast.emit("rtc-signal", {
        ...data,
        senderId: socket.id
      });
    }
  });

  //* 清空历史记录
  socket.on("clearHistory", () => {
    console.log("清空聊天记录人的ID:", socket.id);
    historyList = [];
    io.emit("historyCleared", { _id: socket.id });
  });
});

// WebRTC simple-peer 支持
require("./simple-peer.js")(io);

//* 获取当前所有连接者 socket ID
function roomsArray() {
  if (io && io.sockets && io.sockets.sockets) {
    return Array.from(io.sockets.sockets.keys());
  }
  return [];
}

//* 读取资源文件列表并且广播给所有人，包括自己
function sendAllFiles(socket, nowUploadFile = null) {
  var dirPath = path.resolve(__dirname, "../public/file");
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.readdir(dirPath, (err, files) => {
    if (err || !files) {
      console.error("读取文件列表出错:", err);
      return;
    }
    // 获取资源文件，排除以 . 开头的隐藏文件
    let fileList = files
      .filter((v) => v[0] !== ".")
      .map((v) => {
        let parts = v.split("--");
        let timestamp = Number(parts[0]);
        let fileName = parts.length > 1 ? parts.slice(1).join("--") : v;
        let dateStr = !isNaN(timestamp)
          ? moment(timestamp).format("YYYY-MM-DD HH:mm:ss")
          : "未知时间";
        return {
          path: `/file/${v}`,
          name: fileName,
          date: dateStr,
          originalname: v,
        };
      });
    let data = {
      nowUploadFile: nowUploadFile,
      fileList: fileList,
    };
    // 广播给所有人最新的资源列表
    io.emit("file-list-paths", data);
  });
}

// 抛出 listen 改变监听服务
exports.listen = function (server) {
  io.listen(server);
};
