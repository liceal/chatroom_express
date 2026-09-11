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

// 活跃的群视频聊天室字典: roomId -> { roomId, roomName, creatorId, creatorName, members: Set<socketId>, createdAt, status: 'active' }
var activeGroupRooms = new Map();

function closeGroupRoom(roomId, reason) {
  const room = activeGroupRooms.get(roomId);
  const roomName = room ? room.roomName : "群视频房间";
  activeGroupRooms.delete(roomId);

  // 同步历史记录中该房间卡片的状态为 closed
  historyList.forEach((item) => {
    if (item.type === 2) {
      try {
        let cData = JSON.parse(item.msg);
        if (cData.roomId === roomId) {
          cData.status = "closed";
          cData.closedReason = reason || "empty";
          item.msg = JSON.stringify(cData);
        }
      } catch (e) {}
    }
  });

  // 向所有在线客户端广播该房间已解散关闭
  io.emit("group-room-closed", {
    roomId: roomId,
    roomName: roomName,
    reason: reason || "empty",
  });

  broadcastActiveRooms();
}

function getActiveRoomsList() {
  const activeList = [];
  for (let [rId, r] of activeGroupRooms.entries()) {
    activeList.push({
      roomId: rId,
      roomName: r.roomName,
      memberCount: r.members.size,
      creatorName: r.creatorName,
    });
  }
  return activeList;
}

function broadcastActiveRooms() {
  io.emit("active-group-rooms", getActiveRoomsList());
}

function handleUserLeaveRoom(socketId, roomId) {
  if (!roomId) return;
  const room = activeGroupRooms.get(roomId);
  if (!room) return;
  room.members.delete(socketId);
  if (room.members.size === 0) {
    console.log(`群视频聊天室 [${room.roomName}] (${roomId}) 无人在内，已自动解散！`);
    closeGroupRoom(roomId, "empty");
  } else {
    broadcastActiveRooms();
  }
}

console.log("Socket.IO 服务器端就绪");
io.on("connection", function (socket) {
  console.log("客户端连接:", socket.id);

  const rooms = roomsArray();

  //* 连接成功
  socket.emit("connected", {
    msg: `${socket.id} 连接成功⭕`,
    rooms: rooms,
    historyList: historyList,
    _id: socket.id,
    activeRooms: getActiveRoomsList(),
  });

  //* 广播所有房间信息
  socket.broadcast.emit("rooms", {
    rooms: rooms,
    historyList: historyList,
    _id: socket.id,
  });

  //* 广播所有附件地址
  sendAllFiles(socket);

  //* 广播当前活跃群视频列表
  broadcastActiveRooms();

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

    io.emit("message", msgObj);
  });

  //* 新建群聊天室并向公屏广播邀请卡片
  socket.on("create-group-room", (data) => {
    if (!data || !data.roomId) return;
    const roomName = (data.roomName && data.roomName.trim()) ? data.roomName.trim() : "群聊视频会议";
    const timeStr = moment().format("HH:mm:ss");

    // 若此前在其他群视频房间中，先退出其他房间
    for (let [rId, r] of activeGroupRooms.entries()) {
      if (r.members.has(socket.id) && rId !== data.roomId) {
        handleUserLeaveRoom(socket.id, rId);
        socket.leave(rId);
      }
    }

    // 记录到 activeGroupRooms，初始成员为创建者本人
    const room = {
      roomId: data.roomId,
      roomName: roomName,
      creatorId: socket.id,
      creatorName: socket.id.substring(0, 8),
      members: new Set([socket.id]),
      status: "active",
      time: timeStr,
    };
    activeGroupRooms.set(data.roomId, room);
    socket.join(data.roomId);

    const cardData = {
      roomId: data.roomId,
      roomName: roomName,
      creatorId: socket.id,
      creatorName: socket.id.substring(0, 8),
      time: timeStr,
      status: "active",
    };

    if (historyList.length >= historyLength) {
      historyList.shift();
    }
    historyList.push({
      msg: JSON.stringify(cardData),
      type: 2,
      sender: socket.id,
      time: timeStr
    });

    const msgObj = {
      msg: JSON.stringify(cardData),
      type: 2,
      _id: socket.id,
      time: timeStr
    };

    io.emit("message", msgObj);
    broadcastActiveRooms();
  });

  //* 加入群聊天室鉴权 (验证房间是否存在且至少有1人在内)
  socket.on("join-group-room", (data, callback) => {
    if (!data || !data.roomId) {
      const errResp = { success: false, message: "无效的房间ID" };
      if (typeof callback === "function") callback(errResp);
      socket.emit("join-group-room-result", errResp);
      return;
    }

    const room = activeGroupRooms.get(data.roomId);
    // 必须存在、状态为 active 且至少有 1 个人在内
    if (!room || room.status !== "active" || room.members.size === 0) {
      const closedResp = {
        success: false,
        roomId: data.roomId,
        message: "该聊天室所有成员已离开，已自动解散！"
      };
      if (typeof callback === "function") callback(closedResp);
      socket.emit("join-group-room-result", closedResp);
      // 确认关闭
      closeGroupRoom(data.roomId, "empty");
      return;
    }

    // 若此前在其他群视频房间中，先退出其他房间
    for (let [rId, r] of activeGroupRooms.entries()) {
      if (r.members.has(socket.id) && rId !== data.roomId) {
        handleUserLeaveRoom(socket.id, rId);
        socket.leave(rId);
      }
    }

    room.members.add(socket.id);
    socket.join(data.roomId);

    const okResp = {
      success: true,
      roomId: room.roomId,
      roomName: room.roomName,
      memberCount: room.members.size
    };
    if (typeof callback === "function") callback(okResp);
    socket.emit("join-group-room-result", okResp);
    broadcastActiveRooms();
  });

  //* 离开群聊天室
  socket.on("leave-group-room", (data) => {
    if (data && data.roomId) {
      handleUserLeaveRoom(socket.id, data.roomId);
      socket.leave(data.roomId);
    }
  });

  //* 断开连接 (用户下线)
  socket.on("disconnect", function () {
    console.log("客户端断开连接:", socket.id);

    // 检查此断开的客户端是否在任何群视频房间中
    for (let [roomId, room] of activeGroupRooms.entries()) {
      if (room.members.has(socket.id)) {
        room.members.delete(socket.id);
        if (room.members.size === 0) {
          console.log(`群视频聊天室 [${room.roomName}] (${roomId}) 因最后一位成员离线，自动解散！`);
          closeGroupRoom(roomId, "empty");
        } else {
          broadcastActiveRooms();
        }
      }
    }

    socket.broadcast.emit("disconneted", {
      rooms: roomsArray(),
      _id: socket.id,
    });
  });

  //* WebRTC P2P 信令中继
  socket.on("rtc-signal", (data) => {
    if (!data || !data.type) return;

    if (data.type === "leaveChannel" && data.roomId) {
      handleUserLeaveRoom(socket.id, data.roomId);
      socket.leave(data.roomId);
    }

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
