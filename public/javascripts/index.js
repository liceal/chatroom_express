var sendMsgDiv = null;
var contentDom = null;
var listDom = null;
var filesDom = null;
var userDom = null;
var socket = null;
var localID = null;
var activeGroupRoomsMap = new Map();
var isReplayingHistory = false;

// 常用表情包列表
const EMOJI_LIST = [
  "😀", "😂", "🤣", "😊", "😍", "🥰", "🥳", "😎", 
  "👍", "👎", "🔥", "❤️", "💯", "🎉", "🚀", "💩", 
  "👏", "🙏", "🙈", "🤡", "🥑", "🍺", "✨", "🌟", 
  "💡", "💪", "🤝", "👀", "💬", "⚡", "😴", "🤩"
];

// HTML 实体转义
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 富文本与截图安全清洗 (允许安全 HTML 标签与 base64/HTTP 图片，清洗 script/onerror 等)
function sanitizeRichText(html) {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const allowedTags = new Set([
      "B", "I", "U", "S", "STRONG", "EM", "BR", "DIV", "P",
      "SPAN", "FONT", "IMG", "A", "BLOCKQUOTE", "UL", "OL", "LI"
    ]);

    function cleanNode(node) {
      let child = node.firstChild;
      while (child) {
        let next = child.nextSibling;
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tagName = child.tagName.toUpperCase();
          if (!allowedTags.has(tagName)) {
            if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON"].includes(tagName)) {
              node.removeChild(child);
            } else {
              const textNode = document.createTextNode(child.textContent);
              node.replaceChild(textNode, child);
            }
          } else {
            // 清理危险属性 (on*, javascript:)
            const attrs = Array.from(child.attributes);
            for (let attr of attrs) {
              const name = attr.name.toLowerCase();
              const val = attr.value;
              if (name.startsWith("on") || val.replace(/\s+/g, "").toLowerCase().startsWith("javascript:")) {
                child.removeAttribute(name);
              } else if (tagName === "IMG" && !["src", "alt", "style", "class", "width", "height"].includes(name)) {
                child.removeAttribute(name);
              }
            }
            if (tagName === "A") {
              child.setAttribute("target", "_blank");
              child.setAttribute("rel", "noopener noreferrer");
            }
            cleanNode(child);
          }
        }
        child = next;
      }
    }

    cleanNode(doc.body);
    return doc.body.innerHTML;
  } catch (e) {
    return escapeHTML(html);
  }
}

window.onload = () => {
  socket = io();

  contentDom = $("#content")[0];
  sendMsgDiv = $("#sendMsgDiv")[0];
  listDom = $("#list")[0];
  filesDom = $("#files")[0];
  userDom = $("#user")[0];

  // 监听粘贴剪贴板截图图片
  if (sendMsgDiv) {
    sendMsgDiv.addEventListener("paste", (e) => {
      const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
      if (!items) return;

      for (let item of items) {
        if (item.type.indexOf("image") === 0) {
          e.preventDefault();
          const file = item.getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = document.createElement("img");
            img.src = event.target.result;
            img.style.maxWidth = "100%";
            img.style.maxHeight = "200px";
            img.style.borderRadius = "6px";
            img.style.margin = "4px 0";

            // 插入光标所在位置
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.insertNode(img);
              range.collapse(false);
            } else {
              sendMsgDiv.appendChild(img);
            }
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    });
  }

  // 活跃群视频聊天室状态字典: roomId -> { roomId, roomName, memberCount }
  activeGroupRoomsMap = new Map();
  isReplayingHistory = false;

  function markCardAsClosed(card) {
    if (!card) return;
    card.classList.add("is-closed");
    const subEl = card.querySelector(".group-call-card-sub");
    if (subEl) {
      subEl.innerHTML = `<span class="room-closed-text"><i class="fa-solid fa-circle-xmark"></i> 聊天室已解散 (所有成员已离开)</span>`;
    }
    const titleEl = card.querySelector(".group-call-card-title");
    if (titleEl && !titleEl.querySelector(".badge-room-closed")) {
      const badge = document.createElement("span");
      badge.className = "badge-room-closed";
      badge.innerText = "已解散";
      titleEl.appendChild(badge);
    }
    const btn = card.querySelector(".btn-join-group-card");
    if (btn) {
      btn.classList.add("is-closed");
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-ban"></i> 已解散`;
      btn.onclick = null;
    }
  }

  function markCardAsActive(card, roomId, info) {
    if (!card) return;
    card.classList.remove("is-closed");
    const badge = card.querySelector(".badge-room-closed");
    if (badge) badge.remove();
    const subEl = card.querySelector(".group-call-card-sub");
    if (subEl) {
      const count = (info && typeof info.memberCount === "number") ? info.memberCount : 1;
      const creator = (info && info.creatorName) ? info.creatorName : "群友";
      subEl.innerText = `发起人: ${creator} • 进行中 · 当前 ${count} 人在线`;
    }
    const btn = card.querySelector(".btn-join-group-card");
    if (btn) {
      btn.classList.remove("is-closed");
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> 点击进入`;
      const roomName = (info && info.roomName) || card.getAttribute("data-room-name") || "群视频房间";
      btn.onclick = function () {
        if (window.joinGroupRoom) {
          window.joinGroupRoom(roomId, roomName);
        }
      };
    }
  }

  window.markCardAsClosedById = function (roomId) {
    document.querySelectorAll(`.group-call-card[data-room-id="${roomId}"]`).forEach(markCardAsClosed);
  };

  // Socket 连接成功
  socket.on("connected", (data) => {
    console.log("Socket 连接成功:", data);
    localID = data._id;
    if (userDom) {
      userDom.innerText = `ID: ${data._id.substring(0, 8)}...`;
      userDom.title = `完整 ID: ${data._id}`;
    }

    // 记录活跃房间
    activeGroupRoomsMap.clear();
    if (Array.isArray(data.activeRooms)) {
      data.activeRooms.forEach((r) => {
        if (typeof r === "string") {
          activeGroupRoomsMap.set(r, { roomId: r, memberCount: 1 });
        } else if (r && r.roomId) {
          activeGroupRoomsMap.set(r.roomId, r);
        }
      });
    }

    // 渲染历史数据
    isReplayingHistory = true;
    if (Array.isArray(data.historyList)) {
      data.historyList.forEach((v) => {
        insertMsg(v.msg, v.type || 0, v._id || v.sender, v.time);
      });
    }
    isReplayingHistory = false;

    initRooms(data.rooms);
    showAlert(`成功连接服务器！您的临时 ID 为 <strong>${escapeHTML(data._id)}</strong>`, "info");
  });

  // 活跃群视频房间列表更新
  socket.on("active-group-rooms", (list) => {
    activeGroupRoomsMap.clear();
    if (Array.isArray(list)) {
      list.forEach((r) => activeGroupRoomsMap.set(r.roomId, r));
    }
    // 遍历公屏群视频卡片，根据最新存活状态同步 UI
    document.querySelectorAll(".group-call-card").forEach((card) => {
      const rId = card.getAttribute("data-room-id");
      if (!rId) return;
      if (!activeGroupRoomsMap.has(rId)) {
        markCardAsClosed(card);
      } else {
        const info = activeGroupRoomsMap.get(rId);
        markCardAsActive(card, rId, info);
      }
    });
  });

  // 某群视频房间成员全空，服务器自动解散广播
  socket.on("group-room-closed", (data) => {
    if (!data || !data.roomId) return;
    activeGroupRoomsMap.delete(data.roomId);
    window.markCardAsClosedById(data.roomId);
  });

  // 新用户上线广播
  socket.on("rooms", (data) => {
    initRooms(data.rooms);
    showAlert(`成员 <strong>${escapeHTML(data._id.substring(0, 8))}...</strong> 已上线`, "info");
  });

  // 用户下线广播
  socket.on("disconneted", (data) => {
    initRooms(data.rooms);
    showAlert(`成员 <strong>${escapeHTML(data._id.substring(0, 8))}...</strong> 已离开`, "warning");
  });

  // 接收文本/富文本/图片/群视频邀请卡片消息
  socket.on("message", (data) => {
    insertMsg(data.msg, data.type !== undefined ? data.type : 0, data._id, data.time);
  });

  // 接收独立图片消息
  socket.on("image", (data) => {
    insertMsg(data.file, 1, data._id, data.time);
  });

  // 接收文件列表
  socket.on("file-list-paths", (data) => {
    initFilePaths(data.fileList || []);
  });

  // 历史记录被清空
  socket.on("historyCleared", (data) => {
    contentDom.innerHTML = `
      <div class="chat-welcome">
        <i class="fa-solid fa-shield-cat"></i>
        <p>聊天记录已由成员 ${escapeHTML(data._id.substring(0, 8))}... 清空。</p>
      </div>
    `;
    showAlert("云端聊天记录已清空", "warning");
  });

  // 选择图片按钮
  $("#sendImage").change(function (event) {
    if (this.files && this.files.length > 0) {
      var file = this.files[0];
      if (!/image\/\w+/.test(file.type)) {
        showAlert("请选择图片格式文件！", "danger");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showAlert("发送图片请小于 5MB", "warning");
        return;
      }

      var reader = new FileReader();
      reader.onload = function (e) {
        let base64Img = e.target.result;
        let nowTime = getNowTime();
        socket.emit("image", { file: base64Img });
        insertMsg(base64Img, 1, localID, nowTime);
        event.target.value = "";
      };
      reader.readAsDataURL(file);
    }
  });

  // 发送附件
  $("#sendFile").change(function (event) {
    if (this.files && this.files.length > 0) {
      var file = this.files[0];
      var fd = new FormData();
      fd.append("file", file);

      showAlert(`正在上传文件: ${escapeHTML(file.name)}...`, "info");
      fetch("/file", {
        method: "POST",
        body: fd,
      })
        .then((res) => res.json())
        .then((res) => {
          if (res.file) {
            showAlert("文件上传成功！", "success");
            socket.emit("file-upload-change", res.file);
          } else {
            showAlert(res.msg || "文件上传失败", "danger");
          }
          event.target.value = "";
        })
        .catch((err) => {
          console.error(err);
          showAlert("上传出错，请稍后重试", "danger");
          event.target.value = "";
        });
    }
  });

  // 初始化表情包与手势
  initEmojiPicker();
  initGestureEngine();
  initMobileViewport();
};

// 发送消息 (提取包含图片和格式的 innerHTML)
function send() {
  if (!sendMsgDiv) return;
  
  let htmlContent = sendMsgDiv.innerHTML;
  let textContent = sendMsgDiv.innerText || sendMsgDiv.textContent;

  // 既无文字内容也无图片标签时不发送
  if (!textContent.trim() && !/<img\s/i.test(htmlContent)) {
    return;
  }
  
  sendMsgDiv.innerHTML = "";
  toggleEmojiPicker(false);
  socket.emit("message", htmlContent);
}

// 插入消息到聊天记录面板 (0: 文本/富文本/粘贴图片, 1: 单独上传图片)
function insertMsg(msg, type = 0, senderId = null, timeStr = null) {
  if (!contentDom) return;

  let isSelf = senderId === localID;
  let time = timeStr || getNowTime();

  let msgRow = document.createElement("div");
  msgRow.className = `msg-row ${isSelf ? "self" : "other"}`;

  let metaDiv = document.createElement("div");
  metaDiv.className = "msg-meta";
  let senderName = senderId
    ? isSelf
      ? "我"
      : `用户 (${senderId.substring(0, 6)})`
    : "系统";
  metaDiv.innerText = `${senderName} • ${time}`;

  let bubbleDiv = document.createElement("div");
  bubbleDiv.className = "msg-bubble";

  if (type === 0) {
    // 富文本与图片消息：清洗安全后再插入 DOM
    let cleanHtml = sanitizeRichText(msg);
    bubbleDiv.innerHTML = cleanHtml;
    // 绑定点击放大全屏查看
    bubbleDiv.querySelectorAll("img").forEach((img) => {
      img.onclick = () => openImageModal(img.src);
    });
  } else if (type === 1) {
    // 图片消息
    let imgDom = document.createElement("img");
    imgDom.src = msg;
    imgDom.alt = "发送的图片";
    imgDom.onclick = () => openImageModal(msg);
    bubbleDiv.appendChild(imgDom);
  } else if (type === 2) {
    // 群视频邀请卡片
    let cardData = null;
    try {
      cardData = typeof msg === "string" ? JSON.parse(msg) : msg;
    } catch (e) {
      cardData = { roomName: "群聊视频会议", roomId: "default" };
    }
    const roomId = cardData.roomId || "default";
    const roomName = cardData.roomName || "群视频房间";

    // 若非历史回放且为活跃卡片，注册到活跃房间映射
    if (!isReplayingHistory && cardData.status === "active" && !activeGroupRoomsMap.has(roomId)) {
      activeGroupRoomsMap.set(roomId, {
        roomId: roomId,
        roomName: roomName,
        creatorName: cardData.creatorName || "群友",
        memberCount: 1
      });
    }

    // 判断当前是否已解散：卡片显式 closed，或活跃列表中不存在此 room
    const isClosed = cardData.status === "closed" || !activeGroupRoomsMap.has(roomId);

    let cardEl = document.createElement("div");
    cardEl.className = `group-call-card ${isClosed ? "is-closed" : ""}`;
    cardEl.setAttribute("data-room-id", roomId);
    cardEl.setAttribute("data-room-name", roomName);

    const roomInfo = activeGroupRoomsMap.get(roomId);
    const memberCount = roomInfo && typeof roomInfo.memberCount === "number" ? roomInfo.memberCount : 1;
    let subHtml = isClosed
      ? `<span class="room-closed-text"><i class="fa-solid fa-circle-xmark"></i> 聊天室已解散 (所有成员已离开)</span>`
      : `发起人: ${escapeHTML(cardData.creatorName || "群友")} • 进行中 · 当前 ${memberCount} 人在线`;

    let btnHtml = isClosed
      ? `<button type="button" class="btn-join-group-card is-closed" disabled><i class="fa-solid fa-ban"></i> 已解散</button>`
      : `<button type="button" class="btn-join-group-card" onclick="window.joinGroupRoom && window.joinGroupRoom('${escapeHTML(roomId)}', '${escapeHTML(roomName)}')"><i class="fa-solid fa-arrow-right-to-bracket"></i> 点击进入</button>`;

    cardEl.innerHTML = `
      <div class="group-call-card-icon"><i class="fa-solid fa-users-viewfinder"></i></div>
      <div class="group-call-card-info">
        <div class="group-call-card-title">${escapeHTML(roomName)}${isClosed ? '<span class="badge-room-closed">已解散</span>' : ''}</div>
        <div class="group-call-card-sub">${subHtml}</div>
      </div>
      ${btnHtml}
    `;
    bubbleDiv.appendChild(cardEl);
  }

  msgRow.appendChild(metaDiv);
  msgRow.appendChild(bubbleDiv);
  contentDom.appendChild(msgRow);

  // 滚动条自动底端对齐
  contentDom.scrollTop = contentDom.scrollHeight;
}

// ============ 图片预览器 (缩放 + 拖拽) ============
// 状态变量
var imgViewState = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  lastTranslateX: 0,
  lastTranslateY: 0,
  // 触摸双指缩放
  initialPinchDist: 0,
  initialPinchScale: 1,
  // 触摸双指平移中心
  initialPinchCenterX: 0,
  initialPinchCenterY: 0,
  initialPinchTranslateX: 0,
  initialPinchTranslateY: 0,
};

function resetImgViewState() {
  imgViewState.scale = 1;
  imgViewState.translateX = 0;
  imgViewState.translateY = 0;
  imgViewState.isDragging = false;
}

function applyImgTransform() {
  var modalImg = document.getElementById("modal-img-content");
  if (modalImg) {
    modalImg.style.transform =
      "translate(" + imgViewState.translateX + "px, " + imgViewState.translateY + "px) scale(" + imgViewState.scale + ")";
  }
}

// 打开全屏大图预览 Lightbox
function openImageModal(src) {
  var modal = document.getElementById("image-modal");
  var modalImg = document.getElementById("modal-img-content");
  if (modal && modalImg) {
    resetImgViewState();
    modalImg.src = src;
    modalImg.style.transform = "";
    modal.classList.remove("hidden");
  }
}

// 关闭全屏大图预览 Modal
function closeImageModal() {
  var modal = document.getElementById("image-modal");
  var modalImg = document.getElementById("modal-img-content");
  if (modal) {
    modal.classList.add("hidden");
    if (modalImg) modalImg.style.transform = "";
    resetImgViewState();
  }
}

// ---- 桌面端: 鼠标滚轮缩放 + 鼠标拖拽平移 ----
(function initDesktopImageZoom() {
  document.addEventListener("DOMContentLoaded", function () {
    var modal = document.getElementById("image-modal");
    var modalImg = document.getElementById("modal-img-content");
    if (!modal || !modalImg) return;

    // 滚轮缩放
    modal.addEventListener("wheel", function (e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      imgViewState.scale = Math.min(Math.max(imgViewState.scale + delta, 0.2), 10);
      applyImgTransform();
    }, { passive: false });

    // 鼠标拖拽平移
    modalImg.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return; // 仅左键
      e.preventDefault();
      imgViewState.isDragging = true;
      imgViewState.startX = e.clientX;
      imgViewState.startY = e.clientY;
      imgViewState.lastTranslateX = imgViewState.translateX;
      imgViewState.lastTranslateY = imgViewState.translateY;
      modalImg.style.cursor = "grabbing";
    });

    document.addEventListener("mousemove", function (e) {
      if (!imgViewState.isDragging) return;
      imgViewState.translateX = imgViewState.lastTranslateX + (e.clientX - imgViewState.startX);
      imgViewState.translateY = imgViewState.lastTranslateY + (e.clientY - imgViewState.startY);
      applyImgTransform();
    });

    document.addEventListener("mouseup", function () {
      if (imgViewState.isDragging) {
        imgViewState.isDragging = false;
        var img = document.getElementById("modal-img-content");
        if (img) img.style.cursor = "grab";
      }
    });

    // ---- 移动端: 双指捏合缩放 + 单指/双指拖拽平移 ----
    function getTouchDist(t1, t2) {
      var dx = t1.clientX - t2.clientX;
      var dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    modalImg.addEventListener("touchstart", function (e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        imgViewState.initialPinchDist = getTouchDist(e.touches[0], e.touches[1]);
        imgViewState.initialPinchScale = imgViewState.scale;
        imgViewState.initialPinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        imgViewState.initialPinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        imgViewState.initialPinchTranslateX = imgViewState.translateX;
        imgViewState.initialPinchTranslateY = imgViewState.translateY;
      } else if (e.touches.length === 1) {
        imgViewState.isDragging = true;
        imgViewState.startX = e.touches[0].clientX;
        imgViewState.startY = e.touches[0].clientY;
        imgViewState.lastTranslateX = imgViewState.translateX;
        imgViewState.lastTranslateY = imgViewState.translateY;
      }
    }, { passive: false });

    modalImg.addEventListener("touchmove", function (e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var dist = getTouchDist(e.touches[0], e.touches[1]);
        var ratio = dist / imgViewState.initialPinchDist;
        imgViewState.scale = Math.min(Math.max(imgViewState.initialPinchScale * ratio, 0.2), 10);
        // 双指平移
        var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        imgViewState.translateX = imgViewState.initialPinchTranslateX + (cx - imgViewState.initialPinchCenterX);
        imgViewState.translateY = imgViewState.initialPinchTranslateY + (cy - imgViewState.initialPinchCenterY);
        applyImgTransform();
      } else if (e.touches.length === 1 && imgViewState.isDragging) {
        e.preventDefault();
        imgViewState.translateX = imgViewState.lastTranslateX + (e.touches[0].clientX - imgViewState.startX);
        imgViewState.translateY = imgViewState.lastTranslateY + (e.touches[0].clientY - imgViewState.startY);
        applyImgTransform();
      }
    }, { passive: false });

    modalImg.addEventListener("touchend", function (e) {
      if (e.touches.length < 2) {
        imgViewState.initialPinchDist = 0;
      }
      if (e.touches.length === 0) {
        imgViewState.isDragging = false;
      }
    });

    // 双击复位
    var lastTap = 0;
    modalImg.addEventListener("touchend", function (e) {
      if (e.touches.length !== 0) return;
      var now = Date.now();
      if (now - lastTap < 300) {
        resetImgViewState();
        applyImgTransform();
      }
      lastTap = now;
    });

    // 桌面端双击复位
    modalImg.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      resetImgViewState();
      applyImgTransform();
    });
  });
})();

// 丰富多分类 Emoji 数据源（紧凑、无 search、零外部依赖）
const EMOJI_CATEGORIES = [
  {
    id: "recent",
    name: "常用",
    icon: "fa-regular fa-clock",
    emojis: ["😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "👍", "👎", "🔥", "❤️", "💯", "🎉", "✨", "👏", "🙏", "💪", "🤔", "👀", "🚀", "💩", "👌", "✌️", "🤝"]
  },
  {
    id: "smileys",
    name: "表情",
    icon: "fa-regular fa-face-smile",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
      "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
      "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩",
      "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "😣", "😖",
      "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯",
      "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔",
      "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦",
      "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴",
      "🤢", "🤮", "🤧", "😷", "🤒", "🤕"
    ]
  },
  {
    id: "gestures",
    name: "手势",
    icon: "fa-regular fa-hand",
    emojis: [
      "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉",
      "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋", "💪", "✍️",
      "🙏", "👏", "🙌", "👐", "🤲", "🤝", "👀", "👁️", "👅", "👄",
      "🧠", "🫀", "🫁"
    ]
  },
  {
    id: "animals",
    name: "动物",
    icon: "fa-solid fa-paw",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
      "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🐤", "🦆",
      "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋",
      "🐌", "🐞", "🐜", "🦟", "🐢", "🐍", "🐙", "🦑", "🦐", "🦞",
      "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅",
      "🐆", "🦓", "🦍", "🦧", "🐘", "🦛", "🦏", "🐪", "🦒", "🦘"
    ]
  },
  {
    id: "food",
    name: "美食",
    icon: "fa-solid fa-utensils",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐",
      "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🥦",
      "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕", "🧄", "🧅", "🥔", "🍠",
      "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞",
      "🧇", "🥓", "🥩", "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🥪",
      "🌮", "🌯", "🫔", "🥙", "🧆", "🍜", "🍝", "🍣", "🍱", "🥟",
      "🍧", "🍨", "🍦", "🥧", "🍰", "🎂", "🧁", "🍮", "🍭", "🍬",
      "🍫", "🍿", "🍩", "🍪", "☕", "🍵", "🧃", "🥤", "🧋", "🍺",
      "🍻", "🥂", "🍷", "🍾"
    ]
  },
  {
    id: "sports",
    name: "运动",
    icon: "fa-solid fa-futbol",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🎱", "🏓", "🏸",
      "🥅", "🥊", "🥋", "🎯", "🪀", "🪁", "⛳", "🛹", "🛼", "🛷",
      "⛸️", "🎿", "🏄", "🏊", "🚴", "🏋️", "🧗", "🤸", "🎮", "🕹️",
      "🎲", "🧩", "♟️", "🎭", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹",
      "🥁", "🎷", "🎺", "🎸", "🪕", "🎻"
    ]
  },
  {
    id: "objects",
    name: "物品",
    icon: "fa-solid fa-lightbulb",
    emojis: [
      "⌚", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "📷", "📸",
      "📹", "📼", "🔍", "🔎", "💡", "🔦", "🏮", "📔", "📕", "📖",
      "📗", "📘", "📙", "📚", "📓", "📒", "📃", "📜", "📄", "📰",
      "💳", "💎", "💰", "💵", "💸", "✉️", "📧", "📦", "📫", "✏️",
      "✒️", "🖋️", "📌", "📍", "📎", "🔒", "🔓", "🔑", "🗝️", "🔨",
      "🪓", "🔧", "🪛", "🔩", "⚙️", "🧰", "🧲", "🪜", "🧪", "🔬",
      "🔭", "📡", "💉", "💊", "🩹", "🩺", "🚪", "🪞", "🪟", "🛏️",
      "🛋️", "🚿", "🛁", "🧴", "🧹", "🧺", "🧻", "🧼", "🧽", "🪣",
      "🛎️", "🎁", "🎈", "🎉", "🎊"
    ]
  },
  {
    id: "symbols",
    name: "符号",
    icon: "fa-regular fa-heart",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "☮️",
      "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐",
      "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐",
      "♑", "♒", "♓", "🆔", "⚛️", "🉑", "☢️", "☣️", "📴", "📳",
      "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮", "🉐", "㊙️",
      "㊗️", "🈴", "🈵", "🈲", "🅰️", "🅱️", "🆎", "🆑", "🅾️", "🆘",
      "❌", "⭕", "🛑", "⛔", "📛", "🚫", "💯", "💢", "♨️", "❗",
      "❕", "❓", "❔", "‼️", "⁉️", "💤", "💬", "💭", "🗯️", "♠️",
      "♣️", "♥️", "♦️", "🃏", "🎴", "🀄", "⭐", "🌟", "✨", "⚡",
      "☄️", "💥", "🔥", "🌈", "☀️", "🌤️", "⛅", "🌧️", "🌩️", "❄️", "☃️"
    ]
  }
];

// 初始化轻量多分类表情面板（零外部依赖、极致紧凑、无 search 栏）
function initEmojiPicker() {
  const picker = document.getElementById("emoji-picker");
  if (!picker) return;

  if (picker.dataset.initialized) return;
  picker.dataset.initialized = "true";

  let activeTabId = "recent";

  const renderMultiCategoryPicker = () => {
    picker.innerHTML = `
      <div class="emoji-picker-drag-handle" title="按住向下滑动收起"></div>
      <div class="emoji-tabs-bar" id="emoji-tabs-bar"></div>
      <div class="emoji-grid" id="emoji-grid"></div>
    `;

    renderCategoryTabs();
    renderEmojiGrid(activeTabId);
  };

  const renderCategoryTabs = () => {
    const tabsBar = document.getElementById("emoji-tabs-bar");
    if (!tabsBar) return;
    tabsBar.innerHTML = "";

    EMOJI_CATEGORIES.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `emoji-tab-btn ${cat.id === activeTabId ? "active" : ""}`;
      btn.innerHTML = `<i class="${cat.icon}"></i> <span>${cat.name}</span>`;
      btn.onclick = (e) => {
        e.stopPropagation();
        activeTabId = cat.id;
        renderCategoryTabs();
        renderEmojiGrid(cat.id);
      };
      tabsBar.appendChild(btn);
    });
  };

  const renderEmojiGrid = (catId) => {
    const grid = document.getElementById("emoji-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const cat = EMOJI_CATEGORIES.find((c) => c.id === catId) || EMOJI_CATEGORIES[0];
    cat.emojis.forEach((emoji) => {
      let item = document.createElement("span");
      item.className = "emoji-item";
      item.innerText = emoji;
      item.onclick = (e) => {
        e.stopPropagation();
        insertEmoji(emoji);
      };
      grid.appendChild(item);
    });
  };

  // 始终使用高响应纯前端轻量面板
  renderMultiCategoryPicker();

  // 手势引擎：在输入栏与表情区域按住向下滑动收起表情框
  function initEmojiDragDismiss() {
    const inputWrapper = document.querySelector(".chat-input-wrapper");
    if (!inputWrapper || !picker) return;

    let startY = 0;
    let startX = 0;
    let isTracking = false;
    let isDraggingDown = false;
    let gridScrollTop = 0;

    function onStart(clientY, clientX, target) {
      if (picker.classList.contains("hidden")) return;
      if (!inputWrapper.contains(target) && !picker.contains(target)) return;

      const grid = document.getElementById("emoji-grid");
      if (grid && grid.contains(target)) {
        gridScrollTop = grid.scrollTop;
      } else {
        gridScrollTop = 0;
      }

      startY = clientY;
      startX = clientX;
      isTracking = true;
      isDraggingDown = false;
    }

    function onMove(clientY, clientX, e) {
      if (!isTracking) return;
      if (picker.classList.contains("hidden")) {
        isTracking = false;
        return;
      }

      const deltaY = clientY - startY;
      const deltaX = clientX - startX;

      // 仅当向下拖拽、垂直位移占主导且表情网格处于顶部时接管滑动
      if (deltaY > 6 && Math.abs(deltaY) > Math.abs(deltaX) && gridScrollTop <= 0) {
        isDraggingDown = true;
        if (e.cancelable) {
          e.preventDefault();
        }
        const moveDist = Math.max(0, deltaY * 0.7);
        picker.style.transform = `translateY(${moveDist}px)`;
        picker.style.opacity = `${Math.max(0.15, 1 - moveDist / 120)}`;
        picker.style.transition = "none";
      }
    }

    function onEnd(clientY) {
      if (!isTracking) return;
      isTracking = false;

      if (isDraggingDown) {
        isDraggingDown = false;
        const totalDelta = clientY - startY;
        if (totalDelta > 25) {
          // 向下滑动距离足够 -> 缩回表情框
          picker.style.transition = "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, max-height 0.24s ease";
          picker.style.transform = "translateY(50px)";
          picker.style.opacity = "0";
          setTimeout(() => {
            toggleEmojiPicker(false);
            picker.style.transform = "";
            picker.style.opacity = "";
            picker.style.transition = "";
          }, 200);
        } else {
          // 滑动距离不足 -> 回弹复位
          picker.style.transition = "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease";
          picker.style.transform = "translateY(0)";
          picker.style.opacity = "1";
          setTimeout(() => {
            picker.style.transform = "";
            picker.style.opacity = "";
            picker.style.transition = "";
          }, 200);
        }
      }
    }

    // 移动端 Touch 触摸事件
    inputWrapper.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        onStart(e.touches[0].clientY, e.touches[0].clientX, e.target);
      }
    }, { passive: false });

    document.addEventListener("touchmove", (e) => {
      if (isTracking && e.touches.length === 1) {
        onMove(e.touches[0].clientY, e.touches[0].clientX, e);
      }
    }, { passive: false });

    document.addEventListener("touchend", (e) => {
      if (isTracking) {
        const endY = e.changedTouches.length ? e.changedTouches[0].clientY : startY;
        onEnd(endY);
      }
    });

    document.addEventListener("touchcancel", () => {
      if (isTracking) onEnd(startY);
    });

    // 桌面端 Pointer/Mouse 鼠标拖拽事件
    inputWrapper.addEventListener("pointerdown", (e) => {
      if (e.button === 0) {
        onStart(e.clientY, e.clientX, e.target);
      }
    });

    document.addEventListener("pointermove", (e) => {
      if (isTracking) {
        onMove(e.clientY, e.clientX, e);
      }
    });

    document.addEventListener("pointerup", (e) => {
      if (isTracking) onEnd(e.clientY);
    });

    document.addEventListener("pointercancel", () => {
      if (isTracking) onEnd(startY);
    });
  }

  initEmojiDragDismiss();

  // 点击外部自动关闭表情包
  document.addEventListener("click", (e) => {
    const btn = document.getElementById("emoji-toggle-btn");
    if (!picker || picker.classList.contains("hidden")) return;
    if (picker.contains(e.target) || (btn && btn.contains(e.target))) {
      return;
    }
    toggleEmojiPicker(false);
  });

  // 消息列表滚动时自动关闭表情包
  const content = document.getElementById("content");
  if (content) {
    content.addEventListener("scroll", () => {
      if (!picker.classList.contains("hidden")) {
        toggleEmojiPicker(false);
      }
    }, { passive: true });
  }
}

// 切换表情包面板
function toggleEmojiPicker(arg) {
  const picker = document.getElementById("emoji-picker");
  const btn = document.getElementById("emoji-toggle-btn");
  if (!picker) return;
  initEmojiPicker();

  let forceState;
  if (typeof arg === "boolean") {
    forceState = arg;
  } else if (arg && arg.stopPropagation) {
    arg.stopPropagation();
  }

  const isHidden = picker.classList.contains("hidden");
  const show = forceState !== undefined ? forceState : isHidden;

  if (show) {
    picker.classList.remove("hidden");
    picker.style.transform = "";
    picker.style.opacity = "";
    picker.style.transition = "";
    if (btn) btn.classList.add("active");
    scrollToBottom();
  } else {
    picker.classList.add("hidden");
    picker.style.transform = "";
    picker.style.opacity = "";
    picker.style.transition = "";
    if (btn) btn.classList.remove("active");
  }
}

// 插入表情到输入框
function insertEmoji(emoji) {
  if (!sendMsgDiv) return;
  sendMsgDiv.focus();

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (sendMsgDiv.contains(range.commonAncestorContainer)) {
      const textNode = document.createTextNode(emoji);
      range.insertNode(textNode);
      range.collapse(false);

      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }
  sendMsgDiv.innerHTML += emoji;
}

// 初始化在线用户列表
function initRooms(rooms) {
  if (!listDom || !Array.isArray(rooms)) return;

  const count = rooms.length;
  $("#online-count").text(count);
  $("#header-online-count").text(count);
  $("#desktop-sidebar-count").text(count);
  listDom.innerHTML = "";

  const myId = (typeof localID !== "undefined" && localID) || (typeof socket !== "undefined" && socket && socket.id);

  rooms.forEach((id) => {
    let isMe = (id === myId) || (typeof localID !== "undefined" && id === localID);
    let item = document.createElement("div");
    item.className = `user-item ${isMe ? "is-me" : ""}`;
    
    let avatar = document.createElement("div");
    avatar.className = "user-avatar";
    avatar.innerText = id.substring(0, 2).toUpperCase();

    let nameSpan = document.createElement("span");
    nameSpan.innerText = isMe ? `${id.substring(0, 8)}... (我)` : `${id.substring(0, 12)}...`;

    item.appendChild(avatar);
    item.appendChild(nameSpan);

    // 严禁给自己呼叫：只有非本人条目才渲染拨号按钮
    if (!isMe) {
      let callBtn = document.createElement("button");
      callBtn.className = "btn-call-peer";
      callBtn.title = `一对一呼叫 ${id.substring(0, 8)}...`;
      callBtn.innerHTML = '<i class="fa-solid fa-phone"></i>';
      callBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.startDirectCall) {
          window.startDirectCall(id);
        } else {
          showAlert("视讯模块正在准备中，请稍候...", "info");
        }
      };
      item.appendChild(callBtn);
    }

    listDom.appendChild(item);
  });

  latestRooms = rooms;
  renderLaunchpadUserList();
}

// ============ 音视频呼叫控制台 (Call Launchpad) ============
var latestRooms = [];
var currentLaunchpadTab = "direct";

function openCallLaunchpad(defaultTab = "direct") {
  // 如果通话已在进行中但面板被隐藏，点击视讯通话直接唤醒视讯界面
  if (typeof window.isRtcInChannel === "function" && window.isRtcInChannel()) {
    toggleRtcPanel(true);
    return;
  }
  // 如果当前处于设备预览中但面板被收起，点击直接展开视讯界面
  const drawer = document.getElementById("rtc-drawer");
  if (typeof window.isDevicePreviewing === "function" && window.isDevicePreviewing() && drawer && drawer.classList.contains("hidden")) {
    toggleRtcPanel(true);
    return;
  }
  const modal = document.getElementById("call-launchpad-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  switchLaunchpadTab(defaultTab);
  renderLaunchpadUserList();
  updateLaunchpadPreviewStatus();
}

function updateLaunchpadPreviewStatus() {
  const isPreviewing = (typeof window.isDevicePreviewing === "function" && window.isDevicePreviewing()) ||
                       (typeof window.hasLocalStream === "function" && window.hasLocalStream() && typeof window.isRtcInChannel === "function" && !window.isRtcInChannel());
  const btn = document.getElementById("btn-launchpad-preview");
  const desc = document.getElementById("launchpad-preview-desc");
  if (btn) {
    if (isPreviewing) {
      btn.innerHTML = '<i class="fa-solid fa-stop"></i><span>停止预览</span>';
      btn.classList.add("active");
      btn.title = "退出设备预览并释放硬件资源";
    } else {
      btn.innerHTML = '<i class="fa-solid fa-expand"></i><span>开启预览</span>';
      btn.classList.remove("active");
      btn.title = "开启设备自检与画面预览";
    }
  }
  if (desc) {
    desc.innerText = isPreviewing ? "预览检测进行中，可直接呼叫或停止释放" : "呼叫前测试麦克风音量与摄像头画面";
  }
}
window.updateLaunchpadPreviewStatus = updateLaunchpadPreviewStatus;

function startDevicePreviewFromLaunchpad() {
  const isPreviewing = (typeof window.isDevicePreviewing === "function" && window.isDevicePreviewing()) ||
                       (typeof window.hasLocalStream === "function" && window.hasLocalStream() && typeof window.isRtcInChannel === "function" && !window.isRtcInChannel());
  closeCallLaunchpad();
  if (isPreviewing) {
    if (typeof window.stopDevicePreview === "function") {
      window.stopDevicePreview(true);
    }
  } else {
    if (typeof window.startDevicePreview === "function") {
      window.startDevicePreview();
    }
  }
}
window.startDevicePreviewFromLaunchpad = startDevicePreviewFromLaunchpad;

function closeCallLaunchpad() {
  const modal = document.getElementById("call-launchpad-modal");
  if (modal) modal.classList.add("hidden");
}

function switchLaunchpadTab(tab) {
  currentLaunchpadTab = tab;
  const directBtn = document.getElementById("tab-btn-direct");
  const groupBtn = document.getElementById("tab-btn-group");
  const directContent = document.getElementById("launchpad-tab-direct");
  const groupContent = document.getElementById("launchpad-tab-group");

  if (tab === "direct") {
    if (directBtn) directBtn.classList.add("active");
    if (groupBtn) groupBtn.classList.remove("active");
    if (directContent) directContent.classList.remove("hidden");
    if (groupContent) groupContent.classList.add("hidden");
    renderLaunchpadUserList();
  } else {
    if (groupBtn) groupBtn.classList.add("active");
    if (directBtn) directBtn.classList.remove("active");
    if (groupContent) groupContent.classList.remove("hidden");
    if (directContent) directContent.classList.add("hidden");
  }
}

function renderLaunchpadUserList() {
  const listContainer = document.getElementById("launchpad-user-list");
  if (!listContainer) return;

  const myId = (typeof localID !== "undefined" && localID) || (typeof socket !== "undefined" && socket && socket.id);
  const otherUsers = (latestRooms || []).filter((id) => id !== myId && id !== localID);

  if (otherUsers.length === 0) {
    listContainer.innerHTML = '<div class="launchpad-empty-tip">暂无其他在线好友，可切换到【新建聊天室】开启房间邀请群友！</div>';
    return;
  }

  listContainer.innerHTML = "";
  otherUsers.forEach((id) => {
    const card = document.createElement("div");
    card.className = "launchpad-user-card";

    const meta = document.createElement("div");
    meta.className = "launchpad-user-meta";

    const avatar = document.createElement("div");
    avatar.className = "launchpad-user-avatar";
    avatar.innerText = id.substring(0, 2).toUpperCase();

    const name = document.createElement("span");
    name.className = "launchpad-user-name";
    name.innerText = `用户 ${id.substring(0, 8)}...`;

    meta.appendChild(avatar);
    meta.appendChild(name);

    const callBtn = document.createElement("button");
    callBtn.type = "button";
    callBtn.className = "btn-launchpad-call";
    callBtn.innerHTML = '<i class="fa-solid fa-phone"></i> 一对一呼叫';
    callBtn.onclick = () => {
      closeCallLaunchpad();
      if (window.startDirectCall) {
        window.startDirectCall(id);
      }
    };

    card.appendChild(meta);
    card.appendChild(callBtn);
    listContainer.appendChild(card);
  });
}

function selectQuickRoomTag(tagName) {
  const input = document.getElementById("launchpad-room-input");
  if (input) {
    input.value = tagName;
    input.focus();
  }
}

function submitCreateGroupRoom() {
  const input = document.getElementById("launchpad-room-input");
  const roomName = (input && input.value.trim()) ? input.value.trim() : "群聊多人会议";
  closeCallLaunchpad();

  if (window.createGroupRoom) {
    window.createGroupRoom(roomName);
  }
}

// 初始化共享文件仓库
function initFilePaths(files) {
  if (!filesDom || !Array.isArray(files)) return;

  $("#file-count").text(files.length);
  filesDom.innerHTML = "";

  if (files.length === 0) {
    filesDom.innerHTML = `<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:10px;">暂无文件</div>`;
    return;
  }

  files.forEach((v) => {
    let item = document.createElement("div");
    item.className = "file-item";

    let icon = document.createElement("i");
    icon.className = "fa-solid fa-file-lines file-icon";

    let info = document.createElement("div");
    info.className = "file-info";
    
    let a = document.createElement("a");
    a.href = v.path;
    a.download = v.name;
    a.title = v.name;
    a.innerText = v.name;

    let date = document.createElement("span");
    date.className = "file-date";
    date.innerText = v.date;

    info.appendChild(a);
    info.appendChild(date);

    let delBtn = document.createElement("i");
    delBtn.className = "fa-solid fa-trash-can file-del-btn";
    delBtn.title = "删除此文件";
    delBtn.onclick = () => delFile(v.originalname);

    item.appendChild(info);
    item.appendChild(delBtn);
    filesDom.appendChild(item);
  });
}

// 删除附件请求
function delFile(fileName) {
  if (!confirm(`确定要删除文件 "${fileName}" 吗？`)) return;

  fetch(`/file?fileName=${encodeURIComponent(fileName)}`, {
    method: "DELETE",
  })
    .then((res) => res.json())
    .then((res) => {
      if (res.status === 200) {
        showAlert("文件删除成功", "success");
        socket.emit("file-upload-change", res.file);
      } else {
        showAlert(res.msg || "删除失败", "danger");
      }
    })
    .catch((err) => {
      console.error(err);
      showAlert("删除请求异常", "danger");
    });
}

// 清空云端历史
function clearHistory() {
  if (confirm("确定要清空所有在线用户的云端聊天历史记录吗？")) {
    socket.emit("clearHistory");
  }
}

// PC 端侧边栏折叠状态与自动缩进标记
let isSidebarCollapsed = false;
let autoCollapsedByVideo = false;

// 切换 PC 端侧边栏折叠状态 (在线成员与共享文件仓库)
function toggleDesktopSidebar(forceState, isAutoByVideo = false) {
  const appMain = document.querySelector(".app-main");
  const sidebar = document.querySelector(".app-sidebar");
  const toggleBtn = document.getElementById("desktop-sidebar-toggle-btn");
  const toggleText = document.getElementById("sidebar-toggle-text");
  const toggleIcon = document.getElementById("sidebar-toggle-icon");
  const edgeToggle = document.getElementById("sidebar-edge-toggle");
  if (!appMain || !sidebar) return;

  const currentlyCollapsed = appMain.classList.contains("sidebar-collapsed");
  // forceState: false => 缩进去 (收起), true => 展开
  const toCollapse = forceState !== undefined ? !forceState : !currentlyCollapsed;

  if (toCollapse) {
    // 缩进去 (折叠侧边栏)
    appMain.classList.add("sidebar-collapsed");
    sidebar.classList.add("collapsed");
    isSidebarCollapsed = true;
    if (isAutoByVideo) {
      autoCollapsedByVideo = true;
    } else {
      autoCollapsedByVideo = false; // 用户主动收起，重置自动标识
    }
    if (toggleBtn) {
      toggleBtn.title = "展开侧边栏 (在线成员与共享仓库)";
      toggleBtn.classList.remove("active");
    }
    if (toggleText) toggleText.innerText = "展开";
    if (toggleIcon) toggleIcon.className = "fa-solid fa-angles-left";
    if (edgeToggle) {
      edgeToggle.title = "展开侧边栏 (在线成员与共享仓库)";
      edgeToggle.innerHTML = '<i class="fa-solid fa-angles-left"></i>';
    }
  } else {
    // 展开出来
    appMain.classList.remove("sidebar-collapsed");
    sidebar.classList.remove("collapsed");
    isSidebarCollapsed = false;
    autoCollapsedByVideo = false; // 用户主动展开或恢复，重置自动标识
    if (toggleBtn) {
      toggleBtn.title = "缩进收起侧边栏 (在线成员与共享仓库)";
      toggleBtn.classList.add("active");
    }
    if (toggleText) toggleText.innerText = "侧栏";
    if (toggleIcon) toggleIcon.className = "fa-solid fa-table-columns";
    if (edgeToggle) {
      edgeToggle.title = "缩进/收起侧边栏";
      edgeToggle.innerHTML = '<i class="fa-solid fa-angles-right"></i>';
    }
  }
}
window.toggleDesktopSidebar = toggleDesktopSidebar;

// 如果侧边栏之前是因为开启视频而默认缩进去的，退出视频时自动恢复展开
function restoreDesktopSidebarIfAutoCollapsed() {
  if (autoCollapsedByVideo) {
    autoCollapsedByVideo = false;
    toggleDesktopSidebar(true);
  }
}
window.restoreDesktopSidebarIfAutoCollapsed = restoreDesktopSidebarIfAutoCollapsed;

// 切换 WebRTC 通话抽屉 (移动端在顶部压下，PC端在右侧作为独立模块展开)
function toggleRtcPanel(forceState) {
  const drawer = document.getElementById("rtc-drawer");
  const btn = document.getElementById("toggle-rtc-btn");
  const appMain = document.querySelector(".app-main");
  const chatSection = document.querySelector(".chat-section");
  if (!drawer) return;

  const isHidden = drawer.classList.contains("hidden");
  const show = forceState !== undefined ? forceState : isHidden;

  if (show) {
    drawer.classList.remove("hidden");
    if (btn) btn.classList.add("active");
    if (appMain) appMain.classList.add("has-rtc");
    if (chatSection) chatSection.classList.add("has-rtc");

    // 开启视频默认把在线人员共享仓库缩进去 (PC端大屏)
    if (window.innerWidth > 768) {
      toggleDesktopSidebar(false, true /* isAutoByVideo */);
    }

    scrollToBottom();
  } else {
    drawer.classList.add("hidden");
    if (btn) btn.classList.remove("active");
    if (appMain) appMain.classList.remove("has-rtc");
    if (chatSection) chatSection.classList.remove("has-rtc");

    // 退出视频通话时：如果此前由开启视频默认缩进去，自动恢复展开侧边栏
    restoreDesktopSidebarIfAutoCollapsed();

    // 若未在通话中（仅开启了预览），收起面板时立即释放麦克风与摄像头硬件
    if (typeof window.isRtcInChannel === "function" && !window.isRtcInChannel()) {
      if (typeof window.stopDevicePreview === "function") {
        window.stopDevicePreview(false);
      } else if (typeof window.releaseLocalMedia === "function") {
        window.releaseLocalMedia();
      }
    }
  }

  // 同步更新后台通话常驻提示微标与横幅（杜绝“消失了找不到打开入口”）
  updateActiveCallIndicators();
}
window.toggleRtcPanel = toggleRtcPanel;

// 更新后台进行中通话的唤醒入口 (顶部胶囊与横幅)
function updateActiveCallIndicators() {
  const badge = document.getElementById("active-call-badge");
  const banner = document.getElementById("rtc-minimized-banner");
  const drawer = document.getElementById("rtc-drawer");
  const inCall = typeof window.isRtcInChannel === "function" && window.isRtcInChannel();
  const isDrawerHidden = drawer ? drawer.classList.contains("hidden") : true;

  const shouldShow = inCall && isDrawerHidden;
  if (badge) {
    badge.classList.toggle("hidden", !shouldShow);
  }
  if (banner) {
    banner.classList.toggle("hidden", !shouldShow);
  }
}
window.updateActiveCallIndicators = updateActiveCallIndicators;

// 切换移动端侧边栏 Drawer
function toggleMobileSidebar(forceState) {
  const sidebar = document.querySelector(".app-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  if (!sidebar) return;

  const isHidden = !sidebar.classList.contains("mobile-active");
  const show = forceState !== undefined ? forceState : isHidden;

  if (show) {
    sidebar.classList.add("mobile-active");
    if (overlay) overlay.classList.add("mobile-active");
  } else {
    sidebar.classList.remove("mobile-active");
    if (overlay) overlay.classList.remove("mobile-active");
  }
}

// 平滑滚动回聊天底端
function scrollToBottom() {
  if (contentDom) {
    contentDom.scrollTo({ top: contentDom.scrollHeight, behavior: "smooth" });
  }
}

// 全局移动端触摸手势与滚动监听引擎
function initGestureEngine() {
  // 聊天列表滚动监听
  if (contentDom) {
    const scrollBtn = document.getElementById("scroll-bottom-btn");
    contentDom.addEventListener("scroll", () => {
      const distanceToBottom = contentDom.scrollHeight - contentDom.scrollTop - contentDom.clientHeight;
      if (scrollBtn) {
        if (distanceToBottom > 120) {
          scrollBtn.classList.remove("hidden");
        } else {
          scrollBtn.classList.add("hidden");
        }
      }
    });
  }

  // 移动端手势判断 (右划展开侧边栏 / 左划收起 / 视频向上划收起 / 表情向下划收起)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let activeTouchTarget = null;

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    activeTouchTarget = e.target;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!touchStartX || !touchStartY || e.changedTouches.length !== 1) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const deltaTime = Date.now() - touchStartTime;

    if (deltaTime > 450) return;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // 1. 垂直手势
    if (absY > absX && absY > 40) {
      // 视频频道向上划动 -> 收起视频频道
      const rtcDrawer = document.getElementById("rtc-drawer");
      if (rtcDrawer && rtcDrawer.contains(activeTouchTarget) && !rtcDrawer.classList.contains("hidden")) {
        if (deltaY < -35) {
          toggleRtcPanel(false);
          showAlert("已上滑收起音视频频道", "info");
          return;
        }
      }

      // 表情面板向下划动 -> 收起表情包
      const emojiPicker = document.getElementById("emoji-picker");
      const inputWrapper = document.querySelector(".chat-input-wrapper");
      if (emojiPicker && !emojiPicker.classList.contains("hidden")) {
        if ((emojiPicker.contains(activeTouchTarget) || (inputWrapper && inputWrapper.contains(activeTouchTarget))) && deltaY > 25) {
          toggleEmojiPicker(false);
          return;
        }
      }
    }

    // 2. 水平手势 (移动端右划展开控制台 / 左划收起)
    if (absX > absY && absX > 55 && window.innerWidth <= 768) {
      if (deltaX > 60) {
        // 右划 -> 打开侧边栏
        toggleMobileSidebar(true);
        showAlert("已右滑展开控制台", "info");
      } else if (deltaX < -60) {
        // 左划 -> 收起侧边栏
        toggleMobileSidebar(false);
      }
    }
  }, { passive: true });
}

// Toast 消息提醒
function showAlert(msg = "", type = "info") {
  let container = document.getElementById("alert-container");
  if (!container) return;

  let toast = document.createElement("div");
  toast.className = `alert-toast toast-${type}`;
  
  let iconMap = {
    info: "fa-circle-info",
    success: "fa-circle-check",
    warning: "fa-triangle-exclamation",
    danger: "fa-circle-xmark"
  };

  toast.innerHTML = `
    <i class="fa-solid ${iconMap[type] || "fa-circle-info"}"></i>
    <div>${msg}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(40px)";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3500);
}

function getNowTime() {
  let now = new Date();
  let h = String(now.getHours()).padStart(2, "0");
  let m = String(now.getMinutes()).padStart(2, "0");
  let s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// 动态适配移动端浏览器真实视口高度 (解决 100vh 被地址栏遮挡导致输入框推到屏幕下方的问题)
function initMobileViewport() {
  function updateVh() {
    let vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
  }
  updateVh();
  window.addEventListener("resize", updateVh);
  window.addEventListener("orientationchange", updateVh);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateVh);
  }
}
