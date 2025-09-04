#include<QDebug>
#include<QMutexLocker>
#include<QFile>
#include "./tcpclient.h"
#include"./music.pb.h"



TcpClient::TcpClient(const QString &host, quint16 port) {

    isMutiPackage_ = false;
    musicPackage_ = nullptr;
    musicPackagePos_ = 0;
    MsgmutiPackage_ = media::MsgType::ENU_START;
    musicSavePath_ = std::string(std::getenv("HOME")) + "/Music/";
    is_running = true;

    timer = new QTimer(this);
    socket_ = new QTcpSocket(this);
    socket_->connectToHost(host, port);

    connect(socket_, &QTcpSocket::connected, this, &TcpClient::onConnected);
    connect(socket_, &QTcpSocket::disconnected, this, &TcpClient::onDisconnected);
    connect(socket_, &QTcpSocket::readyRead, this, &TcpClient::onReadyRead);
    connect(socket_, &QTcpSocket::errorOccurred, this, &TcpClient::onErrorOccurred);

    connect(timer, &QTimer::timeout, this, &TcpClient::network_idle_status);
    start();

    qInfo() << "start connect server.";
}

TcpClient::~TcpClient() {
    socket_->close();

    wait();

    qInfo() << "Tcpclient destructor.";
}

void TcpClient::onConnected() {
    qDebug() << "Connected to server!";

    //socket_->write("Hello from Qt TCP Client!");
}

void TcpClient::onDisconnected() {
    qDebug() << "Disconnected from server!";
}

void TcpClient::onReadyRead() {
    //QByteArray data = socket_->readAll();
    qDebug() << "Received data from server:";
    QMutexLocker lock(&mutMsgList_);
    msglist_.append(socket_->readAll());
    lock.unlock();
    msgCondition_.wakeOne();

    timer->setSingleShot(true);
    timer->start(4000);
}

void TcpClient::onErrorOccurred(QTcpSocket::SocketError socketError) {
    qDebug() << "Error occurred:" << socket_->errorString();
}

void TcpClient::writeData(const std::string& data) {
    socket_->write(data.c_str());
}

void TcpClient::run() {
    qInfo() << "start msg processor.";

    while(is_running) {
        QMutexLocker lock(&mutMsgList_);

        if(msglist_.empty()) {
            msgCondition_.wait(&mutMsgList_);
        }

        for(const auto& arr : msglist_) {
            //qInfo() << "Size of msg: " << arr.size();
            parseMsg(arr);
        }

        msglist_.clear();
    }

    qInfo() << "Exit msg processor.";
}

void TcpClient::player_exit() {
    is_running = false;
    msgCondition_.notify_all();
}

MsgHeader TcpClient::parseMsgHeader(const QByteArray& msgData) {
    MsgHeader header;
    int times = 0;
    int prev_pos;
    int pos = -1;
    while ((pos = msgData.indexOf(':', pos + 1)) != -1) {
        qDebug() << "Found ':' at index:" << pos;

        ++times;
        if (times == 1) {
            header.type = static_cast<media::MsgType>(msgData[pos - 1] - '0');
            prev_pos = pos;
        } else if (times == 2) {
            uint32_t len = 0;
            QString str = QString::fromUtf8(msgData.mid(prev_pos + 1, pos - prev_pos - 1));
            qInfo() << "str: " << str ;
            bool ok = false;
            header.datalen = str.toUInt(&ok);

            if(!ok) {
                qInfo() << "datalen parse error.";
                break;
            }
            header.datapos = pos + 1;
            prev_pos = pos;

        } else {
            qInfo() << "unknown message.";
            break;
        }
    }


    return header;
}
bool TcpClient::parseMsg(const QByteArray& msgData) {

    if (isMutiPackage_) {
        qint32 ret = mergingPackage(msgData);
        if(ret > 0) {
            return true;
        } else if (ret == 0) {

            isMutiPackage_ = false;
            MsgmutiPackage_ = media::MsgType::ENU_START;
            if (musicPackage_ != nullptr) {
                delete[] musicPackage_;
                musicPackage_ = nullptr;
            }
            return true;
        } else {
            // exception
            return false;
        }
    }

    //qInfo() << "msgData: " << msgData;
    MsgHeader header = parseMsgHeader(msgData);
    qInfo() << "header datalen: " << header.datalen;

    uint32_t pos = header.datapos;

    switch (header.type) {
        case media::MsgType::ENU_LOGIN_RSP: {
            parseLoginRsp(msgData, pos);
            break;
        }
        case media::MsgType::ENU_PLAY_ONLINE_RANDOM_RSP: {
            parsePlayOnlineRandomRsp(msgData, pos);
            break;
        }
        case media::MsgType::ENU_DOWNLOAD_SINGLE_MUSIC_RSP: {
            qInfo() << "Received single music, size: " << msgData.size();

            parseDownloadSingleMusicRsp(msgData, header, pos);
            break;
        }
        default:
            break;
    }

    return true;
}

bool TcpClient::saveSingleMusicToFile() {

    media::DownloadSingleMusicRsp rsp;

    rsp.ParseFromArray(musicPackage_, packageTotalSize_);
    //rsp.ParsePartialFromArray(musicPackage_, packageTotalSize_);

    qInfo() << "Music name: " << rsp.musicname() << ",file size: " << rsp.filesize();

    int len = rsp.data().size();
    qInfo() << "data size: " << len;

    QString qData = QString::fromStdString(rsp.data());

    qInfo() << "qData size: " << qData.size();

    std::string filePath = std::string(musicSavePath_ + rsp.musicname());

    QFile file(filePath.c_str());
    if (file.open(QIODevice::WriteOnly | QIODevice::Truncate)) {

        file.write(rsp.data().c_str(), rsp.data().size());
        file.close();
        qDebug() << "Data successfully written to output.txt";
    } else {
        qDebug() << "Failed to open file for writing!";
    }


    return true;
}

qint32 TcpClient::mergingPackage(const QByteArray& msgData) {


    if (musicPackagePos_ <= packageTotalSize_) {

        memcpy(musicPackage_ + musicPackagePos_, msgData.data(), msgData.size());
        musicPackagePos_ += msgData.size();
        //qInfo() << "mergingPackage musicPackagePos_: " << musicPackagePos_ << ", packageTotalSize_: " << packageTotalSize_;
    }

    if (musicPackagePos_ == packageTotalSize_) {
        saveSingleMusicToFile();
        emit download_single_music_response();
        return 0;
    }

    if (musicPackagePos_ > packageTotalSize_) {
        emit download_single_music_response();
        return -1;
    }

    return 1;
}

void TcpClient::parseDownloadSingleMusicRsp(const QByteArray& msgData, const MsgHeader& header, const qint32 offset) {
    isMutiPackage_ = true;
    MsgmutiPackage_ = header.type;
    packageTotalSize_ = header.datalen;
    musicPackage_ = new char[packageTotalSize_];
    musicPackagePos_ = msgData.size() - offset;
    qInfo() << "parseDownloadSingleMusicRsp musicPackagePos_: " << musicPackagePos_;
    memcpy(musicPackage_, msgData.data() + offset, musicPackagePos_);


}

void TcpClient::parsePlayOnlineRandomRsp(const QByteArray& msgData, const qint32 offest) {
    media::PlayOnlineRandomRsp rsp;
    rsp.ParseFromString((msgData.right(msgData.size() - offest )).toStdString());

    qInfo() << rsp.musicname_size();

    QVector<std::string> v;
    for(const auto& name :  rsp.musicname())
    {
        v.push_back(name);
        //qInfo() << "name: " << name;
    }

    emit play_online_random_response(v);
}
void TcpClient::parseLoginRsp(const QByteArray& msgData, const qint32 offest) {
    media::LoginRsp rsp;

    rsp.ParseFromString((msgData.right(msgData.size() - offest )).toStdString());
    qInfo() << "Parse login rsp, username: " << rsp.username();


    if (rsp.username() == "hml") {
        qInfo()<< "Login success";
        emit login_success();
    }
}

void TcpClient::network_idle_status() {
    qInfo() << "Network idle, unlock ui with network now.";

    // if server not send rsp, we should monitor status of network and unlock ui button.
    emit download_single_music_response();


}
