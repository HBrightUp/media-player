#ifndef MONITORDIR_H
#define MONITORDIR_H
#include<QObject>
#include<QThread>


class Worker : public QThread
{
    Q_OBJECT
public:
    Worker();
    void run() override;
    void notify_exit();

private:
    bool is_contain_music_suffix(const char* filename);

 signals:
    void update_current_player_list();

 private:
    bool exit_;
    std::vector<std::string> suffix_;
};

#endif // MONITORDIR_H
