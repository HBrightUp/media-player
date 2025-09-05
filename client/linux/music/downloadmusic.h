#ifndef DOWNLOADMUSIC_H
#define DOWNLOADMUSIC_H

#include <QObject>
#include <QThread>
#include<QList>
#include<QMutex>
#include<QMutexLocker>
#include"tcpclient.h"

class DownloadMusic : public QThread
{
    Q_OBJECT
public:
    explicit DownloadMusic(QObject *parent = nullptr);

    void run() override;

    void update_music_list(const QSharedPointer<TcpClient>& client, const QString& music_name, const QString& username);

public slots:
    void download_single_music_response_recv();

private:
    QList<QString> musicList_;
    QMutex MuxList_;
    QSharedPointer<TcpClient> client_;
    QWaitCondition ConditionList_;

    QString username_;
};

#endif // DOWNLOADMUSIC_H
