var sendMsgInput = null
var sendMsgDiv = null
var contentDom = null
var listDom = null
var filesDom = null
var userDom = null
var socket = null
var list = null


window.onload = () => {

  socket = io()

  console.log('socket实例', socket);

  contentDom = $('#content')[0]
  sendMsgInput = $('#sendMsg')[0]
  sendMsgDiv = $('#sendMsgDiv')[0]
  listDom = $('#list')[0]
  filesDom = $('#files')[0]

  //连接成功
  socket.on('connected', (data) => {
    console.log('连接成功', data);
    userDom = $('#user')[0];
    userDom.innerHTML = `ID：${data._id}`;
    //* 渲染historyList历史数据
    data.historyList.forEach(v => {
      insertMsg(v)
    })
    initRooms(data.rooms)
    showAlert(`你的ID是：<strong>${data._id}</strong>`, 'info')
  })

  //新用户加入
  socket.on('rooms', (data) => {
    console.log('新用户加入', data);
    initRooms(data.rooms)
    showAlert(`ID：<strong>${data._id}</strong> 上线`)
  })

  //有用户离开
  socket.on('disconneted', (data) => {
    console.log('有用户离开', data);
    initRooms(data.rooms)
    showAlert(`ID：<strong>${data._id}</strong> 下线`, 'warning')
  })

  //接收消息
  socket.on('message', (data) => {
    console.log('服务端消息', data);
    insertMsg(data.msg)
  })

  //接收图片base64
  socket.on('image', (data) => {
    console.log('接收文件', data);
    insertImage(data.file)
  })

  //接收资源列表
  socket.on('file-list-paths', (data) => {
    initFilePaths(data.fileList)
  })

  //选择图片
  $('#sendImage').change(function (event) {
    console.log(this.files);
    if (this.files.length !== 0) {
      var file = this.files[0];
      //判断文件是否为图片
      if (!/image\/\w+/.test(file.type)) {
        alert('文件必须为图片！')
        return
      } else if (file.size > 2097152) {
        alert('上传图片请小于2M')
        return
      }

      reader = new FileReader();
      if (!reader) {
        alert('文件读取失败')
        return
      }
      reader.onload = function (e) {
        //资源加载完 发送base64资源
        console.log('资源文件', e);
        let data = {
          file: e.target.result
        }
        socket.emit('image', data)
        insertImage(data.file)
        event.target.value = ""//清空资源,这样可以进行下次上传，注意event是onchange给的回调
      }
      reader.readAsDataURL(file)
    }
  })

  //发送附件
  $('#sendFile').change(function (event) {
    console.log(this.files);
    if (this.files.length !== 0) {
      var file = this.files[0]
      var fd = new FormData()
      fd.append('file', file)
      //! 注意不用加header 否则会报错
      fetch('/file', {
        method: 'post',
        body: fd
      }).then(res => res.json()).then(res => {
        console.log('文件上传成功，文件信息：', res);
        socket.emit('file-upload-change', res.file)
      })
    }

  })

}

//回车发送消息
function enterSend(event) {
  if (event.keyCode === 13) {
    send()
  }
}

//发送消息 这里改成div节点所以监听innerHTML
function send() {
  // let sendMsg = sendMsgInput.value
  let sendMsg = sendMsgDiv.innerHTML
  console.log(sendMsgDiv.innerHTML);
  if (sendMsg === "") {
    return
  }
  // sendMsgInput.value = ""
  sendMsgDiv.innerHTML = ""
  socket.emit('message', sendMsg)
}

//插入消息队列 0文字消息，1图片文件
function insertMsg(msg, type = 0) {
  let line = document.createElement('div')
  line.className = 'line'
  if (type === 0) {
    line.innerHTML = msg
  } else if (type === 1) {
    line.appendChild(msg)
  }
  contentDom.appendChild(line)
  contentDom.scrollTop = contentDom.scrollHeight //滚动条到最底部
}

//插入图片消息
function insertImage(file) {
  // console.log(file);
  let imgDom = document.createElement('img')
  imgDom.src = file
  imgDom.style.maxHeight = '200px'
  insertMsg(imgDom, 1)
}

// 初始化在线人
function initRooms(rooms) {
  console.log('在线人', rooms);
  listDom.innerHTML = ""
  let lines = document.createElement('div')
  lines.id = 'lines'
  rooms.forEach((v) => {
    let line = document.createElement('div')
    line.className = "line"
    line.innerHTML = v
    lines.appendChild(line)
  })
  listDom.appendChild(lines)

}

// 删除资源
function delFile(fileName) {
  console.log(fileName);
  fetch(`/file?fileName=${fileName}`, {
    method: 'delete',
  }).then(res => res.json()).then(res => {
    if (res.status === 200) {
      console.log('文件删除成功');
      showAlert('文件删除成功')
      // 发送删除成功socket 广播所有人
      socket.emit('file-upload-change', res.file)
    } else if (res.status === 500) {
      // 文件删除失败 不做任何处理
      console.log('文件删除失败');
      showAlert('文件删除失败', 'danger')
    }
  })
}

// 初始化文件列表
function initFilePaths(files) {
  console.log('资源', files);
  filesDom.innerHTML = ""
  let lines = document.createElement('div')
  lines.id = 'lines'
  files.forEach(v => {
    let line = document.createElement('div')
    line.className = 'line'
    line.innerHTML = `
    ${v.date}
    <br>
    <a href="${v.path}" download="${v.name}">${v.name}</a>
    <b style="float: right;cursor: pointer;" onclick="delFile('${v.originalname}')">x</b>
    `
    lines.appendChild(line)
  })
  filesDom.appendChild(lines)
}

//弹窗
function showAlert(msg = "弹窗消息", type = "success") {
  let alertDom = document.createElement('div')
  alertDom.className = [`alert alert-${type}`]
  alertDom.setAttribute('role', 'alert')
  alertDom.innerHTML = `
  ${msg}
  <button type="button" class="close" data-dismiss="alert" aria-label="Close">
    <span aria-hidden="true">&times;</span>
  </button>
  `
  $('#alert-container')[0].appendChild(alertDom)

  //使用jq获取dom本身可以得到proto继承属性
  alertDom = $(alertDom)

  setTimeout(() => {
    alertDom.addClass('fade')
    alertDom.alert('close')
  }, 3000)
}

//清空信息
function clearHistory() {
  contentDom.innerHTML = ""
  socket.emit('clearHistory')
}