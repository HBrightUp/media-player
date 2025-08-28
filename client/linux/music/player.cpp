#include "player.h"
#include "./ui_player.h"
#include<QDebug>
#include<QFileDialog>
#include<QDir>
#include<QIcon>
#include<QSize>
#include<QFontDatabase>
#include<QRandomGenerator>
#include<QImageReader>
#include<QKeyEvent>

Player::Player(QWidget *parent)
    : QWidget(parent)
    , ui(new Ui::Player)
{
    ui->setupUi(this);


    current_play_index_ = 0;
    current_theme_ = 0;
    is_silder_pressed_ = false;
    play_mode_ = PlayMode::ENU_LOOP;

    setWindowIcon(QIcon(":/app-icon.ico"));

    // load media and audio
    //audio_(new QAudioOutput(this));
    audio_.reset(new QAudioOutput(this));

    // set volume(0.00~1.00)  valueChanged
    audio_->setVolume(0.5);

    player_.reset(new QMediaPlayer(this));
    //player_ = new QMediaPlayer(this);
    player_.get()->setAudioOutput(audio_.get());

    timer.reset(new QTimer);

    init_ui();

    // listen the progress of player and set total length of slider .
    connect(player_.get(), &QMediaPlayer::durationChanged, this, &Player::media_durationChanged);

    // Set progressplayer_list_ bar of slider in real time
    connect(player_.get(), &QMediaPlayer::positionChanged, this, [=](qint64 pos){

        ui->lab_pos->setText(QString("%1:%2").arg(pos / 1000 / 60, 2, 10, QChar('0')).arg(pos / 1000 % 60, 2, 10, QChar('0')));
        if (!is_silder_pressed_) {
            ui->music_slider->setValue(pos);
        }
    });

    //  Monitor the playing status of the music, and if one song is finished, play the next one.
    connect(player_.get(), &QMediaPlayer::mediaStatusChanged, [=](QMediaPlayer::MediaStatus status){
        if (status == QMediaPlayer::MediaStatus::EndOfMedia) {
            switch(play_mode_) {
            case PlayMode::ENU_SINGLE: {
                player_->play();
                break;
            }
            case PlayMode::ENU_LOOP: {
                play_next();
                break;
            }
            case PlayMode::ENU_RAND: {
                play_rand();
                break;
            }
            }
            //play_next();
        }
    });

    connect(player_.get(), &QMediaPlayer::playbackStateChanged,[=](QMediaPlayer::PlaybackState newState){
        if (newState == QMediaPlayer::PlaybackState::StoppedState || newState == QMediaPlayer::PlaybackState::PausedState) {
            ui->btn_play->setIcon(QIcon(":/play-pause.png"));
            ui->btn_play->setIconSize(ui->btn_play->size());
        } else if(newState == QMediaPlayer::PlaybackState::PlayingState) {
            ui->btn_play->setIcon(QIcon(":/play-playing.png"));
            ui->btn_play->setIconSize(ui->btn_play->size());
        } else {

        }
    });


    //  Listen for users dragging the slider to play music.
    //connect(ui->music_slider, &QSlider::sliderMoved, player_, &QMediaPlayer::setPosition);
    connect(ui->music_slider, &QSlider::sliderPressed, this, [=]() {
        is_silder_pressed_ = true;
    });
    connect(ui->music_slider, &QSlider::sliderReleased, this, [=]() {
        int pos = ui->music_slider->value();
        is_silder_pressed_ = false;
        player_->setPosition(pos);
    });

    connect(timer.get(), &QTimer::timeout, this, &Player::change_theme_by_timer);
    timer.get()->start(20000);

    connect(ui->list_music, &QListWidget::itemClicked, this,[](QListWidgetItem *item) {
        qInfo() << "item click";
    });

}
void Player::media_durationChanged(qint64 duration) {
    qint64 total_sec = duration / 1000;

    Player::ui->lab_total->setText(QString("%1:%2").arg(total_sec / 60, 2, 10, QChar('0')).arg(total_sec % 60, 2, 10, QChar('0')));
    ui->music_slider->setRange(0, duration);
}

void Player::init_ui() {

    //  load font for QListWidget
    int fontId = QFontDatabase::addApplicationFont(":/jianglan.ttf");
    if (fontId != -1) {
        QStringList fontFamilies = QFontDatabase::applicationFontFamilies(fontId);
        if (!fontFamilies.isEmpty()){
            QString familyName = fontFamilies.first();
            QFont font(familyName);
            font.setPointSize(14);
            font.setWeight(QFont::Weight::Light);
            ui->list_music->setFont(font);

        }
    }

    // set background for application.
    ui->lab_bk->setPixmap(QPixmap(":/bk1.png"));

    ui->btn_directory->setIconSize(ui->btn_directory->size());
    ui->btn_directory->setIcon(QIcon(":/add-dir.png"));

    ui->btn_theme->setIconSize(ui->btn_theme->size());
    ui->btn_theme->setIcon(QIcon(":/theme.png"));

    ui->btn_playmode->setIcon(QIcon(":/playmode-loop.png"));
    ui->btn_playmode->setIconSize(ui->btn_playmode->size());

    ui->btn_prev->setIcon(QIcon(":/play-prev.png"));
    ui->btn_prev->setIconSize(ui->btn_prev->size());

    ui->btn_play->setIcon(QIcon(":/play-pause.png"));
    ui->btn_play->setIconSize(ui->btn_play->size());

    ui->btn_next->setIcon(QIcon(":/play-next.png"));
    ui->btn_next->setIconSize(ui->btn_next->size());

    set_mute(false);

    // set default director of music.
    update_player_list(QDir::homePath() + "/Music");

    QString strStyle = "QListWidget{font-size:18px;   "
                       "color: darkBlue; background:#00000000;"
                       "padding-left:0px;"
                       "border: none solid none}"
                       "QListWidget::item{height:30px; }"
                       /*列表项扫过时文本、背景变化*/
                       "QListWidget::item:hover{color: darkGreen; background: #FFC0CB;}"
                       /**列表项选中*/
                       "QListWidget::item::selected{ color: white; background: #b4446c;}";

    ui->list_music->setStyleSheet(strStyle);

}

bool Player::is_playable() {
    return !playlist_.empty();
}

Player::~Player()
{
    player_->stop();
    playlist_.clear();
    delete ui;
}

void Player::on_btn_directory_clicked()
{
    QString path = QFileDialog::getExistingDirectory(this, "Select directory of music:", "/home/hml/Music");
    if (path.isEmpty()) {
        return ;
    }

    update_player_list(path);
}
void Player::update_player_list(const QString& path){

    if(!playlist_.empty()) {
        playlist_.clear();
        ui->list_music->clear();
    }

    QDir dir(path);
    QStringList music_list = dir.entryList(QStringList() << "*.mp3" <<"*.wav");
    for(auto& file : music_list) {
        playlist_.append(QUrl::fromLocalFile(path + "/"+ file));
    }

    for(auto& list : music_list) {
        ui->list_music->addItem(list.left(list.size() - 4));
    }

    ui->list_music->setCurrentRow(0);
}

void Player::on_btn_play_clicked()
{
    if (!is_playable()) {
        return ;
    }

    switch (player_->playbackState()) {
    case QMediaPlayer::PlaybackState::StoppedState:
    {
        current_play_index_ = ui->list_music->currentRow();
        player_->setSource(playlist_[current_play_index_]);
        player_->play();
        break;
    }
    case QMediaPlayer::PlaybackState::PlayingState:
        player_->pause();
        break;
    case QMediaPlayer::PlaybackState::PausedState:
        player_->play();
        break;
    default:
        break;
    }
}

void Player::on_btn_next_clicked()
{
    if (!is_playable()) {
        return ;
    }

    play_next();
}
void Player::play_next() {

    current_play_index_ = (current_play_index_ + 1) % playlist_.size();
    ui->list_music->setCurrentRow(current_play_index_);
    player_->setSource(playlist_[current_play_index_]);
    player_->play();
}

void Player::play_rand() {
    current_play_index_ = QRandomGenerator::global()->bounded(playlist_.size());
    qInfo() << current_play_index_;
    ui->list_music->setCurrentRow(current_play_index_);
    player_->setSource(playlist_[current_play_index_]);
    player_->play();
}


void Player::on_btn_prev_clicked()
{
    if (!is_playable()) {
        return ;
    }

    if (current_play_index_ == 0) {
        current_play_index_ = playlist_.size() - 1;
    } else {
        current_play_index_ = (current_play_index_ - 1) % playlist_.size();
    }

    ui->list_music->setCurrentRow(current_play_index_);
    player_->setSource(playlist_[current_play_index_]);
    player_->play();
}


void Player::on_list_music_doubleClicked(const QModelIndex &index)
{
    if (!is_playable()) {
        return ;
    }

    current_play_index_ = index.row();
    ui->list_music->setCurrentRow(current_play_index_);

    player_->setSource(playlist_[current_play_index_]);
    player_->play();
}


void Player::on_btn_volume_clicked()
{
    set_mute(!audio_->isMuted());

    //emit send_message(1, "watch film");
}

void Player::set_mute(bool mute) {
    if (mute) {
        audio_->setMuted(true);
        ui->btn_volume->setIcon(QIcon(":/volume-mute.png"));
        ui->btn_volume->setIconSize(ui->btn_volume->size());
    } else {
        audio_->setMuted(false);
        ui->btn_volume->setIcon(QIcon(":/volume.png"));
        ui->btn_volume->setIconSize(ui->btn_volume->size());
    }
}

void Player::on_btn_theme_clicked()
{
    // switch(current_theme_) {
    //     case 0: {
    //         QPixmap pixmap(":/bk2.jpg");
    //         QPixmap scaledPixmap = pixmap.scaled(360, 640, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
    //         ui->lab_bk->setPixmap(scaledPixmap);
    //         current_theme_ = 1;
    //         break;
    //     }
    //     case 1: {
    //         QPixmap pixmap(":/bk3.jpg");
    //         QPixmap scaledPixmap = pixmap.scaled(ui->lab_bk->size(), Qt::KeepAspectRatioByExpanding, Qt::FastTransformation);
    //         ui->lab_bk->setPixmap(scaledPixmap);
    //         current_theme_ = 2;
    //         break;
    //     }
    //     case 2: {
    //         QPixmap pixmap(":/bk4.jpg");
    //         QPixmap scaledPixmap = pixmap.scaled(ui->lab_bk->size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
    //         ui->lab_bk->setPixmap(scaledPixmap);
    //         current_theme_ = 3;
    //         break;
    //     }
    //     case 3: {
    //         current_theme_ = 4;
    //         break;
    //     }
    //     case 4: {
    //         QPixmap pixmap(":/bk1.png");
    //         QPixmap scaledPixmap = pixmap.scaled(ui->lab_bk->size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
    //         ui->lab_bk->setPixmap(scaledPixmap);
    //         current_theme_ = 0;
    //         break;
    //     }
    // }

    // ui->lab_bk->resize(360, 640);

    load_next_theme();
}

void Player::on_btn_playmode_clicked()
{
    qInfo() << play_mode_;
    if (play_mode_ == PlayMode::ENU_RAND) {
        play_mode_ = PlayMode::ENU_SINGLE;
        ui->btn_playmode->setIcon(QIcon(":/playmode-single.png"));
    } else if (play_mode_ == PlayMode::ENU_SINGLE) {
        play_mode_ = PlayMode::ENU_LOOP;
        ui->btn_playmode->setIcon(QIcon(":/playmode-loop.png"));
    } else {
        play_mode_ = PlayMode::ENU_RAND;
        ui->btn_playmode->setIcon(QIcon(":/playmode-rand.png"));
    }

}

void Player::load_next_theme() {

    switch(current_theme_) {
    case 0: {
        QPixmap pixmap(":/bk2.jpg");
        QPixmap scaledPixmap = pixmap.scaled(360, 640, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
        ui->lab_bk->setPixmap(scaledPixmap);
        current_theme_ = 1;
        break;
    }
    case 1: {
        QPixmap pixmap(":/bk3.jpg");
        QPixmap scaledPixmap = pixmap.scaled(ui->lab_bk->size(), Qt::KeepAspectRatioByExpanding, Qt::FastTransformation);
        ui->lab_bk->setPixmap(scaledPixmap);
        current_theme_ = 2;
        break;
    }
    case 2: {
        QPixmap pixmap(":/bk4.jpg");
        QPixmap scaledPixmap = pixmap.scaled(ui->lab_bk->size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
        ui->lab_bk->setPixmap(scaledPixmap);
        current_theme_ = 3;
        break;
    }
    case 3: {
        current_theme_ = 4;
        break;
    }
    case 4: {
        QPixmap pixmap(":/bk1.png");
        QPixmap scaledPixmap = pixmap.scaled(ui->lab_bk->size(), Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation);
        ui->lab_bk->setPixmap(scaledPixmap);
        current_theme_ = 0;
        break;
    }
    }

    ui->lab_bk->resize(360, 640);
}

void Player::change_theme_by_timer() {

    load_next_theme();

    qint64 rand_number = QRandomGenerator::global()->bounded(30, 60);
    timer.get()->start(rand_number * 1000);
}


void Player::on_list_music_itemClicked(QListWidgetItem *item)
{

}

bool Player::eventFilter(QObject *obj, QEvent *event) {

    qInfo() << event->type();

    //ui->list_music->eventFilter()

    return true;
}
void Player::keyReleaseEvent(QKeyEvent *event) {
    qInfo() << "Key down: " << event->key();

    if (event->key() == Qt::Key_Escape) {
        //this->hide();
    }

    switch (event->key()) {
        case Qt::Key_F: {
        if (event->key() == Qt::Key_F) {
                qInfo() << "ctrl + F key down.";

        }

            break;
        }
        case Qt::Key_Escape: {
            //this->hide();
            break;
        }
        default:{
            QWidget::keyPressEvent(event);
        }
    }

}






