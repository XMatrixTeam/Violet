/*
  Copyright (c) 2017 XMatrix Studio
  Licensed under the MIT license

  Description: User API 实现
 */

const fs = require('fs');
const COS = require('cos-nodejs-sdk-v5'); // cos模块
const cosConfig = JSON.parse(fs.readFileSync('./config/cos.json'));
const cos = new COS(cosConfig);
const db = require('./mongo.js');
const site = require('./site.js');
const verify = require('./sdk/verify.js');
const spawn = require('child_process').spawn; //异步子进程模块
const multiparty = require('multiparty');
let userSchema = db.violet.Schema({
  uid: Number,
  token: Number,
  vCode: Number,
  name: String,
  password: String,
  email: String,
  detail: String,
  web: String,
  phone: String,
  sex: Number,
  valid: Boolean,
  birthDate: String,
  emailTime: Date,
  sites: [Number],
  class: Number,
  avatar: Boolean,
}, { collection: 'users' });
let userDB = db.violet.model('users', userSchema);


exports.db = userDB;

// ------------------------------------------------
exports.register = (req, res, next) => {
  if (!regExp(/^[a-zA-Z0-9]{3,20}$/, req.body.name, 'ILLEGAL_NAME', res, next)) return;
  if (!regExp(/^(\w)+(\.\w+)*@(\w)+((\.\w{2,9}))$/, req.body.email, 'ILLEGAL_EMAIL', res, next)) return;
  userDB.count({ name: { "$regex": "^" + req.body.name + "$", "$options": "i" } }, (err, val) => {
    if (err) {
      sendErr(err, res, next);
    } else if (val) {
      sendErr('MULTIPLE_NAME', res, next);
    } else {
      register_email(req, res, next);
    }
  });
};

let register_email = (req, res, next) => {
  userDB.count({ email: { "$regex": "^" + req.body.email + "$", "$options": "i" } }, (err, val) => {
    if (err) {
      sendErr(err, res, next);
    } else if (val) {
      sendErr('MULTIPLE_EMAIL', res, next);
    } else {
      register_write(req, res, next);
    }
  });
};

let register_write = (req, res, next) => {
  userDB.count({}, (err, val) => {
    if (err) {
      sendErr(err, res, next);
    } else {
      db.insertDate(userDB, {
        uid: 100 + val,
        name: req.body.name,
        password: verify.makeASha(req.body.password),
        email: req.body.email,
        sex: 2,
        valid: false,
        class: 0,
      }, () => {
        res.send({
          state: 'ok',
          name: req.body.name,
          email: req.body.email,
        });
      });
    }
  });
};
// ------------------------------------------------

exports.login = (req, res, next) => {
  if (req.body.user.indexOf('@') == -1) { // 用户名登陆
    userDB.findOne({ name: { "$regex": "^" + req.body.user + "$", "$options": "i" } }, (err, val) => {
      if (val === null) {
        sendErr('NO_USERNAME', res, next);
      } else {
        login_pwd(req, res, next, val);
      }
    });
  } else { // 邮箱登陆
    userDB.findOne({ email: { "$regex": "^" + req.body.user + "$", "$options": "i" } }, (err, val) => {
      if (val === null) {
        sendErr('NO_EMAIL', res, next);
      } else {
        login_pwd(req, res, next, val);
      }
    });
  }
};

let login_pwd = (req, res, next, userVal) => {
  if (userVal.password === verify.makeASha(req.body.password)) {
    sendSiteInfo(req, res, next, userVal);
  } else {
    sendErr('ERR_PWD', res, next);
  }
};

let sendSiteInfo = (req, res, next, userVal) => {
  site.findSiteById(req.body.sid, (val) => {
    if (userVal.valid === true) {
      let theSiteName;
      if (val === null) {
        theSiteName = 'VIOLET';
      } else {
        theSiteName = val.name;
      }
      verify.makeNewToken(req, res, userVal.uid, () => {
        getUserAvatar(userVal.uid, (url) => {
          res.send({
            state: 'ok',
            siteName: theSiteName,
            email: userVal.email,
            name: userVal.name,
            src: url,
          });
        });
      });
    } else {
      verify.makeNewToken(req, res, userVal.uid, () => {
        res.send({
          state: 'failed',
          reason: 'VALID_EMAIL',
          email: userVal.email,
          name: userVal.name,
          // 头像
        });
      });
    }
  });
};

// ------------------------------------------------
exports.getCode = (req, res, next) => {
  if (!regExp(/^(\w)+(\.\w+)*@(\w)+((\.\w{2,9}))$/, req.body.email, 'ILLEGAL_EMAIL', res, next)) return;
  userDB.findOne({ email: req.body.email }, (err, val) => {
    if (val !== null) {
      let nowTime = new Date();
      if (val.emailTime === undefined ||
        (nowTime.getTime() - val.emailTime.getTime()) > 60) {
        let code = Math.round(100000 + Math.random() * 1000000);
        val.emailTime = nowTime;
        val.vCode = code;
        val.save((err) => {});
        getCode_sendEmail(req, res, next, code);
      } else {
        sendErr('WAITING_TIME', res, next);
      }
    } else {
      sendErr('NO_EMAIL', res, next);
    }
  });
};


let getCode_sendEmail = (req, res, next, code) => {
  let mail1 = fs.readFileSync('data/mail1.data');
  let mail2 = fs.readFileSync('data/mail2.data');
  fs.writeFile('mail.html', mail1 + code + mail2, (err) => {
    if (err) console.error(err);
    spawn('./sendMail.sh', [req.body.email]);
    console.log('OK: send a code Email.');
  });
  res.send({ state: 'ok' });
};

// ------------------------------------------------

exports.reset = (req, res, next) => {
  if (!regExp(/^(\w)+(\.\w+)*@(\w)+((\.\w{2,9}))$/, req.body.email, 'ILLEGAL_EMAIL', res, next)) return;

  userDB.findOne({ email: req.body.email }, (err, val) => {
    let nowTime = new Date();
    if (val === null) {
      sendErr('NO_EMAIL', res, next);
    } else if (val.vCode == req.body.vCode && val.emailTime !== undefined && verify.comTime(val.emailTime) < 600) {
      nowTime.setFullYear(2000, 1, 1);
      val.password = verify.makeASha(req.body.password);
      val.emailTime = nowTime;
      val.valid = true;
      val.save((err) => {});
      res.send({ state: 'ok' });
    } else {
      sendErr('ERR_CODE', res, next);
    }
  });
};

// ------------------------------------------------

exports.auth = (req, res, next) => {
  site.findSiteById(req.body.sid, (val) => {
    if (val !== null) {
      let userId = verify.getUserId(res);
      let siteUrl = val.url;
      userDB.findOne({ uid: userId }, (err, val) => {
        if (val.sites.indexOf(req.body.sid) == -1) {
          val.sites.push(req.body.sid);
          val.save((err) => {});
        }
        site.addTimesById(req.body.sid); // 增加访问次数
        res.send({ state: 'ok', url: siteUrl, code: createCode(verify.getUserId(res)) });
      });
    } else {
      sendErr('NO_SITE', res, next);
    }
  });
};

exports.noAuth = (req, res, next) => {
  userDB.findOne({ uid: verify.getUserId(res) }, (err, val) => {
    let newList = [];
    for (let i = 0; i < val.sites.length; ++i) {
      if (val.sites[i] != req.body.sid) {
        newList.push(val.sites[i]);
      }
    }
    val.sites = newList;
    val.save((err) => {});
    res.send({ state: 'ok' });
  });
};

let createCode = (uid) => {
  let userData = uid + '&' + verify.getNowTime();
  return verify.encrypt(userData);
};

// ------------------------------------------------
exports.getInfo = (req, res, next) => {
  site.findSiteById(req.body.sid, (val) => {
    if (val === null) {
      sendErr('NO_SITE', res, next);
    } else {
      let userData = verify.decrypt(req.body.userToken).split('&');
      let webData = verify.decrypt(req.body.webToken, val.key).split('&');
      if (userData[0] === undefined || userData[1] === undefined || (verify.getNowTime() - userData[1]) > 60) {
        sendErr('USER_ERR', res, next);
      } else if (webData[0] === undefined || webData[1] === undefined || (verify.getNowTime() - webData[1]) > 60) {
        sendErr('WEB_ERR', res, next);
      } else {
        userDB.findOne({ uid: userData[0] }, (err, val) => {
          if (!val) {
            sendErr('USER_ERR', res, next);
          } else {
            getUserAvatar(userData[0], (src) => {
              res.send({
                state: 'ok',
                uid: val.uid,
                name: val.name,
                email: val.email,
                phone: val.phone,
                detail: val.detail,
                web: val.web,
                sex: val.sex,
                birthDate: val.birthDate,
                avatar: src,
              });
            });
          }
        });
      }
    }
  });
};

// ------------------------------------------------
//激活邮箱
exports.validEmail = (req, res, next) => {
  userDB.findOne({ email: req.body.email }, (err, val) => {
    if (val === null) { // 邮箱不存在
      sendErr('NO_EMAIL', res, next);
    } else {
      if (val.vCode != req.body.vCode) { //验证码错误
        sendErr('ERR_CODE', res, next);
      } else if (verify.comTime(val.emailTime) > 600) {
        sendErr('TIMEOUT', res, next);
      } else { //验证码正确
        let nowTime = new Date();
        nowTime.setFullYear(2000, 1, 1);
        userData = val;
        userData.valid = true;
        sendSiteInfo(req, res, next, userData);
        val.valid = true;
        val.emailTime = nowTime;
        val.save((err) => {});
      }
    }
  });
};
// ------------------------------------------------
exports.getUser = (req, res, next) => {
  userDB.findOne({ uid: verify.getUserId(res) }, (err, val) => {
    sendSiteInfo(req, res, next, val);
  });
};

// ------------------------------------------------
// ------------------------------------------------

let regExp = (reg, str, err, res, next) => {
  if (reg.test(str)) {
    return true;
  } else {
    sendErr(str, res, next);
    return false;
  }
};

let sendErr = (str, res, next) => {
  console.log('ERR: ' + str);
  res.send({
    state: 'failed',
    reason: str
  });
  next('route');
};


// -------------------------------------------------------------

exports.mGetUserInfo = (req, res, next) => {
  userDB.findOne({ uid: verify.getUserId(res) }, (err, val) => {
    site.findSiteByArray(val.sites, (webData) => {
      getUserAvatar(verify.getUserId(res), (src) => {
        res.send({
          state: 'ok',
          userData: {
            name: val.name,
            email: val.email,
            web: val.web,
            birthDate: val.birthDate,
            detail: val.detail,
            phone: val.phone,
            sex: val.sex,
            sites: val.sites,
            class: val.class,
            avatar: src,
          },
          webData: webData,
        });
      });
    });
  });
};

exports.mSetUserInfo = (req, res, next) => {
  userDB.findOne({ uid: verify.getUserId(res) }, (err, val) => {
    if (req.body.web) val.web = req.body.web.replace(/\'/g, '').replace(/\"/g, '');
    if (req.body.birthDate) val.birthDate = req.body.birthDate.replace(/\'/g, '').replace(/\"/g, '');
    if (req.body.detail) val.detail = req.body.detail.replace(/\'/g, '').replace(/\"/g, '');
    if (req.body.phone) val.phone = req.body.phone.replace(/\'/g, '').replace(/\"/g, '');
    if (req.body.sex) val.sex = req.body.sex.replace(/\'/g, '').replace(/\"/g, '');
    val.save((err) => {});
    res.send({ state: 'ok' });
  });
};


exports.changeAvatar = function(req, res, next) {
  let form = new multiparty.Form();
  form.parse(req, function(err, fields, files) {
    if (files.croppedImage[0].size > 1048576) {
      res.send({ state: 'failed', reason: 'BIG_FILE' });
      return;
    }
    uploadToCos(verify.getUserId(res) + '.png', files.croppedImage[0]).then((data) => {
      userDB.findOne({ uid: verify.getUserId(res) }, (err, val) => {
        val.avatar = true;
        val.save(() => {});
      });
      res.send({ state: 'ok', src: cosConfig.violetUrl + verify.getUserId(res) + '.png' });
    }).catch((err) => {
      res.send({ state: 'failed', reason: err });
    });
  });
};

function getUserAvatar(uid, callback) {
  userDB.findOne({ uid: uid }, (err, val) => {
    if (val && val.avatar === true) {
      cos.headObject({
        Bucket: cosConfig.violetBucket,
        Region: cosConfig.violetRegion,
        Key: uid + '.png',
      }, function(err, data) {
        if (err) {
          callback(cosConfig.violetUrl + '0.png');
        } else {
          callback(cosConfig.violetUrl + uid + '.png');
        }
      });
    } else {
      callback(cosConfig.violetUrl + '0.png');
    }
  });
}


function uploadToCos(name, file) {
  let params = {
    Bucket: cosConfig.violetBucket,
    Region: cosConfig.violetRegion,
    Key: name,
    ContentLength: file.size,
    ContentDisposition: name,
    ContentType: 'image/png',
    Body: fs.createReadStream(file.path),
  };
  let p = new Promise((resolve, reject) => {
    cos.putObject(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
  return p;
}