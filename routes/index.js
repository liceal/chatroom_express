var express = require('express');
var router = express.Router();
var multer = require('multer');
var fs = require('fs');
var path = require('path');

var envUploadDir = process.env.UPLOAD_DIR || 'public/file';
var UPLOAD_DIR = path.isAbsolute(envUploadDir) 
  ? envUploadDir 
  : path.resolve(__dirname, '..', envUploadDir);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

var maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '52428800', 10); // 50MB 默认

var upload = multer({
  limits: {
    fileSize: maxFileSize
  },
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, UPLOAD_DIR);
    },
    filename(req, file, cb) {
      cb(null, `${Date.now()}--${file.originalname}`);
    }
  })
});

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Socket.IO 实时聊天室' });
});

//* 接收资源文件 并且保存在本地
router.post('/file', upload.single('file'), function (req, res, next) {
  if (req.file && req.file.fieldname) {
    res.status(200).send({ file: req.file });
  } else {
    res.status(400).send({ status: 400, msg: '无有效文件上传' });
  }
});

//* 删除资源文件 (防护 Path Traversal 路径穿越攻击)
router.delete('/file', function (req, res, next) {
  var fileName = req.query.fileName;
  if (!fileName) {
    return res.status(400).send({ status: 400, msg: '缺少文件名参数' });
  }

  // 严格过滤文件名，仅保留基础文件名
  var safeFileName = path.basename(fileName);
  var targetPath = path.resolve(UPLOAD_DIR, safeFileName);

  // 验证路径安全，必须在 UPLOAD_DIR 目录下
  if (!targetPath.startsWith(UPLOAD_DIR)) {
    return res.status(403).send({ status: 403, msg: '非法的文件删除请求' });
  }

  fs.unlink(targetPath, (err) => {
    if (err) {
      console.error('删除文件失败:', err);
      return res.status(500).send({
        status: 500,
        msg: '文件删除失败',
        file: safeFileName
      });
    }
    res.send({
      status: 200,
      msg: '文件删除成功',
      file: safeFileName
    });
  });
});

module.exports = router;
