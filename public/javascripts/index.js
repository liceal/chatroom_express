var sendMsgDiv = null;
var contentDom = null;
var listDom = null;
var filesDom = null;
var userDom = null;
var socket = null;
var localID = null;

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

  // Socket 连接成功
  socket.on("connected", (data) => {
    console.log("Socket 连接成功:", data);
    localID = data._id;
    if (userDom) {
      userDom.innerText = `ID: ${data._id.substring(0, 8)}...`;
      userDom.title = `完整 ID: ${data._id}`;
    }

    // 渲染历史数据
    if (Array.isArray(data.historyList)) {
      data.historyList.forEach((v) => {
        insertMsg(v.msg, v.type || 0, v._id || v.sender, v.time);
      });
    }
    initRooms(data.rooms);
    showAlert(`成功连接服务器！您的临时 ID 为 <strong>${escapeHTML(data._id)}</strong>`, "info");
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

  // 接收文本/富文本/图片消息
  socket.on("message", (data) => {
    insertMsg(data.msg, 0, data._id, data.time);
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

// 初始化表情包面板
function initEmojiPicker() {
  const picker = document.getElementById("emoji-picker");
  if (!picker) return;

  picker.innerHTML = "";
  EMOJI_LIST.forEach((emoji) => {
    let item = document.createElement("span");
    item.className = "emoji-item";
    item.innerText = emoji;
    item.onclick = (e) => {
      e.stopPropagation();
      insertEmoji(emoji);
    };
    picker.appendChild(item);
  });
}

// 切换表情包面板
function toggleEmojiPicker() {
  const picker = document.getElementById("emoji-picker");
  if (picker) {
    picker.classList.toggle("hidden");
  }
}

// 插入表情到输入框
function insertEmoji(emoji) {
  if (!sendMsgDiv) return;
  sendMsgDiv.focus();

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const textNode = document.createTextNode(emoji);
    range.insertNode(textNode);
    range.collapse(false);
  } else {
    sendMsgDiv.innerHTML += emoji;
  }
}

// 初始化在线用户列表
function initRooms(rooms) {
  if (!listDom || !Array.isArray(rooms)) return;

  const count = rooms.length;
  $("#online-count").text(count);
  $("#header-online-count").text(count);
  listDom.innerHTML = "";

  rooms.forEach((id) => {
    let isMe = id === localID;
    let item = document.createElement("div");
    item.className = `user-item ${isMe ? "is-me" : ""}`;
    
    let avatar = document.createElement("div");
    avatar.className = "user-avatar";
    avatar.innerText = id.substring(0, 2).toUpperCase();

    let nameSpan = document.createElement("span");
    nameSpan.innerText = isMe ? `${id.substring(0, 8)}... (我)` : `${id.substring(0, 12)}...`;

    item.appendChild(avatar);
    item.appendChild(nameSpan);
    listDom.appendChild(item);
  });
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

    let info = document.createElement("div");
    info.className = "file-info";

    let a = document.createElement("a");
    a.className = "file-name";
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

// 切换 WebRTC 通话抽屉
function toggleRtcPanel() {
  const drawer = document.getElementById("rtc-drawer");
  if (drawer) {
    drawer.classList.toggle("hidden");
    drawer.style.transform = "";
  }
}

// 切换移动端侧边栏 Drawer
function toggleMobileSidebar() {
  const sidebar = document.querySelector(".app-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  if (sidebar) {
    sidebar.classList.toggle("mobile-active");
    sidebar.style.transform = "";
  }
  if (overlay) {
    overlay.classList.toggle("mobile-active");
  }
}

// 平滑滚动回聊天底端
function scrollToBottom() {
  if (contentDom) {
    contentDom.scrollTo({ top: contentDom.scrollHeight, behavior: "smooth" });
  }
}

// 动态滚动监听 (向上翻阅历史消息时浮现回底按钮)
function initGestureEngine() {
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
