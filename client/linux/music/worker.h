#ifndef WORKER_H
#define WORKER_H
#include<QObject>
#include<QThread>

class Worker : public QThread
{
    Q_OBJECT
public:
    Worker();
    void run() override;

private:
    bool is_contain_music_suffix(const char* filename);

 signals:
    void update_current_player_list();
};

#endif // WORKER_H
