#ifndef TCPCLIENT_H
#define TCPCLIENT_H

#include <QObject>
#include <QTcpSocket>
#include<QByteArray>
#include<QList>
#include<QMutex>
#include<QThread>
#include<QWaitCondition>
#include<QVector>
#include<QTimer>
#include"./msg_assembly.h"
#include"./msgprocessor.h"
#include"./signals_type.h"

struct MsgHeader{
    media::MsgType type;
    uint32_t datalen;
    uint32_t  datapos;
};

class TcpClient : public QThread
{
    Q_OBJECT
public:
    TcpClient(const QString &host, quint16 port);
    ~TcpClient();

public slots:
    void onConnected();
    void onDisconnected();
    void onReadyRead();
    void onErrorOccurred(QTcpSocket::SocketError socketError);

    void writeData(const std::string& buf);

    void run() override;
    bool parseMsg(const  QByteArray& msgData);
    void parseLoginRsp(const QByteArray& msgData, const qint32 offest);
    void parsePlayOnlineRandomRsp(const QByteArray& msgData, const qint32 offest);

    void player_exit();
private:
    MsgHeader parseMsgHeader(const QByteArray& msgData);
    void parseDownloadSingleMusicRsp(const QByteArray& msgData, const MsgHeader& header, const qint32 offest);
    qint32 mergingPackage(const QByteArray& msgData);
    bool saveSingleMusicToFile();
private slots:
    void network_idle_status();

signals:
    void login_success();
    void play_online_random_response(const QVector<std::string>& musicList);
    void download_single_music_response();

private:
    QTcpSocket *socket_;
    QList<QByteArray> msglist_;
    QMutex mutMsgList_;
    QWaitCondition msgCondition_;

    std::string musicSavePath_;

    bool isMutiPackage_;
    media::MsgType MsgmutiPackage_;
    char* musicPackage_;
    qint32 musicPackagePos_;
    qint32 packageTotalSize_;

    QTimer* timer;
    volatile bool is_running;
};

#endif // TCPCLIENT_H
