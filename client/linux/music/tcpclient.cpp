#include<QDebug>
#include<QMutexLocker>
#include "./tcpclient.h"

TcpClient::TcpClient(const QString &host, quint16 port) {
    socket_ = new QTcpSocket(this);
    socket_->connectToHost(host, port);

    connect(socket_, &QTcpSocket::connected, this, &TcpClient::onConnected);
    connect(socket_, &QTcpSocket::disconnected, this, &TcpClient::onDisconnected);
    connect(socket_, &QTcpSocket::readyRead, this, &TcpClient::onReadyRead);
    connect(socket_, &QTcpSocket::errorOccurred, this, &TcpClient::onErrorOccurred);


    start();

    qInfo() << "start connect server.";
}

TcpClient::~TcpClient() {
    socket_->close();

    wait();
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
    //qDebug() << "Received data from server:" << data;
    QMutexLocker lock(&mutMsgList_);
    msglist_.append(socket_->readAll());
     qInfo() << "333";
    lock.unlock();
    msgCondition_.wakeOne();
}

void TcpClient::onErrorOccurred(QTcpSocket::SocketError socketError) {
    qDebug() << "Error occurred:" << socket_->errorString();
}

void TcpClient::writeData(const std::string& data) {
    socket_->write(data.c_str());
}

void TcpClient::run() {
    qInfo() << "start msg processor.";

    while(true) {
        QMutexLocker lock(&mutMsgList_);

        if(msglist_.empty()) {
            msgCondition_.wait(&mutMsgList_);
        }

        for(const auto& arr : msglist_) {
            qInfo() << arr;
            parseMsgHeader(arr);
        }

        msglist_.clear();

    }
}

void TcpClient::parseMsgHeader(const QByteArray& msgData) {

    qint32 pos = msgData.indexOf(':');
    if (pos < 0) {
        return ;
    }

    qInfo() << "msgData size: " << msgData.size();
    qInfo() << "msgData: " << msgData;

    QString cmdstr = msgData.left(pos);
    bool ok;
    qint32 type = cmdstr.toInt(&ok);
    if (!ok) {
        return ;
    }
    media::MsgType cmd = static_cast<media::MsgType>(type);
    qInfo()<< "cmd: " << cmd ;
    switch (cmd) {
        case media::MsgType::RESPONSE: {
        parseResponse(msgData, pos + 1);
            break;
        }
        default:
            break;
    }
}
void TcpClient::parseResponse(const QByteArray& msgData, const qint32 offest) {
    media::Response rsp;

    rsp.ParseFromString((msgData.right(msgData.size() - offest )).toStdString());

    std::cout << "cmd: "<< rsp.cmd() << ", code: " << rsp.code() << std::endl;

    if (rsp.cmd() == media::MsgType::LOGIN && rsp.code() == 200) {
        qInfo()<< "send login success";
        emit login_success();
    }
}
