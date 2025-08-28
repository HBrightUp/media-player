#ifndef PLAYER_H
#define PLAYER_H

#include <QWidget>
#include<QMediaPlayer>
#include<QAudioOutput>
#include<QUrl>
#include<QSharedPointer>
#include<QTimer>
#include<QListWidgetItem>

QT_BEGIN_NAMESPACE
namespace Ui {
class Player;
}
QT_END_NAMESPACE

enum PlayMode {
    ENU_SINGLE,
    ENU_LOOP,
    ENU_RAND,
};



class Player : public QWidget
{
    Q_OBJECT

public:
    Player(QWidget *parent = nullptr);
    ~Player();

private slots:
    void on_btn_directory_clicked();
    void on_btn_play_clicked();
    void on_btn_next_clicked();
    void on_btn_prev_clicked();
    void on_list_music_doubleClicked(const QModelIndex &index);
    void on_btn_volume_clicked();
    void on_btn_theme_clicked();
    void on_btn_playmode_clicked();
    void on_list_music_itemClicked(QListWidgetItem *item);

    void init_ui();
    void update_player_list(const QString& path);
    void play_next();
    void play_rand();
    bool is_playable();
    void set_mute(bool mute);

    void change_theme_by_timer();
    void media_durationChanged(qint64 duration);
    void load_next_theme();

signals:
    void send_message(int msg_id, QString data);

private:
    Ui::Player *ui;
    QSharedPointer<QAudioOutput> audio_;
    QSharedPointer<QMediaPlayer> player_;
    QSharedPointer<QTimer> timer;

    QList<QUrl> playlist_;

    int current_play_index_;
    quint8 current_theme_;
    bool is_silder_pressed_;
    PlayMode play_mode_;


    // QWidget interface
protected:
    bool eventFilter(QObject *obj, QEvent *event) override;
    void keyReleaseEvent(QKeyEvent *event) override ;
};
#endif // PLAYER_H
