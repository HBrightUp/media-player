package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUserAlreadyExists = errors.New("user already exists")

//go:embed schema.sql
var initSQL string

type Store struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, initSQL)
	return err
}

func (s *Store) GetSetting(ctx context.Context, key string) (models.LibrarySetting, error) {
	var setting models.LibrarySetting
	err := s.pool.QueryRow(ctx, `
		SELECT value, updated_at
		FROM settings
		WHERE key = $1
	`, key).Scan(&setting.Path, &setting.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.LibrarySetting{}, sql.ErrNoRows
	}
	return setting, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) (models.LibrarySetting, error) {
	var setting models.LibrarySetting
	err := s.pool.QueryRow(ctx, `
		INSERT INTO settings (key, value, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, updated_at = now()
		RETURNING value, updated_at
	`, key, value).Scan(&setting.Path, &setting.UpdatedAt)
	return setting, err
}

func (s *Store) CreateUser(ctx context.Context, user models.User) (models.User, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (
			phone,
			country_code,
			nickname,
			password_hash,
			password_salt,
			terms_accepted_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, now(), now())
		ON CONFLICT (phone) DO NOTHING
		RETURNING id, phone, country_code, nickname, password_hash, password_salt, terms_accepted_at, created_at, updated_at
	`,
		user.Phone,
		user.CountryCode,
		user.Nickname,
		user.PasswordHash,
		user.PasswordSalt,
	).Scan(
		&user.ID,
		&user.Phone,
		&user.CountryCode,
		&user.Nickname,
		&user.PasswordHash,
		&user.PasswordSalt,
		&user.TermsAcceptedAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.User{}, ErrUserAlreadyExists
	}
	return user, err
}

func (s *Store) GetUserByPhone(ctx context.Context, phone string) (models.User, error) {
	var user models.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, phone, country_code, nickname, password_hash, password_salt, terms_accepted_at, created_at, updated_at
		FROM users
		WHERE phone = $1
	`, phone).Scan(
		&user.ID,
		&user.Phone,
		&user.CountryCode,
		&user.Nickname,
		&user.PasswordHash,
		&user.PasswordSalt,
		&user.TermsAcceptedAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	return user, err
}

func (s *Store) GetUserByID(ctx context.Context, id int64) (models.User, error) {
	var user models.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, phone, country_code, nickname, password_hash, password_salt, terms_accepted_at, created_at, updated_at
		FROM users
		WHERE id = $1
	`, id).Scan(
		&user.ID,
		&user.Phone,
		&user.CountryCode,
		&user.Nickname,
		&user.PasswordHash,
		&user.PasswordSalt,
		&user.TermsAcceptedAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	return user, err
}

func (s *Store) UpsertTrack(ctx context.Context, track models.Track) (int64, error) {
	var coverMimeType any
	var coverData any
	var coverHash any
	if track.Cover != nil && track.Cover.MimeType != "" && len(track.Cover.Data) > 0 {
		coverMimeType = track.Cover.MimeType
		coverData = track.Cover.Data
		coverHash = track.Cover.Hash
	}

	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO tracks (
			path,
			relative_path,
			filename,
			title,
			artist,
			album,
			format,
			size_bytes,
			duration_seconds,
			modified_at,
			cover_mime_type,
			cover_data,
			cover_hash,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
		ON CONFLICT (path)
		DO UPDATE SET
			relative_path = EXCLUDED.relative_path,
			filename = EXCLUDED.filename,
			title = EXCLUDED.title,
			artist = EXCLUDED.artist,
			album = EXCLUDED.album,
			format = EXCLUDED.format,
			size_bytes = EXCLUDED.size_bytes,
			duration_seconds = EXCLUDED.duration_seconds,
			modified_at = EXCLUDED.modified_at,
			cover_mime_type = EXCLUDED.cover_mime_type,
			cover_data = EXCLUDED.cover_data,
			cover_hash = EXCLUDED.cover_hash,
			updated_at = now()
		RETURNING id
	`,
		track.Path,
		track.RelativePath,
		track.Filename,
		track.Title,
		track.Artist,
		track.Album,
		track.Format,
		track.SizeBytes,
		track.DurationSeconds,
		track.ModifiedAt,
		coverMimeType,
		coverData,
		coverHash,
	).Scan(&id)
	return id, err
}

func (s *Store) ClearTracks(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM tracks`)
	return err
}

func (s *Store) DeleteTracksExceptPaths(ctx context.Context, paths []string) error {
	if len(paths) == 0 {
		return s.ClearTracks(ctx)
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM tracks WHERE NOT (path = ANY($1))`, paths)
	return err
}

func (s *Store) ListTracks(ctx context.Context) ([]models.Track, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			id,
			path,
			relative_path,
			filename,
			title,
			artist,
			album,
			format,
			size_bytes,
			duration_seconds,
			modified_at,
			(cover_mime_type IS NOT NULL AND cover_mime_type <> '' AND cover_data IS NOT NULL) AS has_cover
		FROM tracks
		ORDER BY lower(title), lower(artist), id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tracks := make([]models.Track, 0)
	for rows.Next() {
		track, err := scanTrack(rows)
		if err != nil {
			return nil, err
		}
		tracks = append(tracks, track)
	}
	return tracks, rows.Err()
}

func (s *Store) ListFavoriteTracks(ctx context.Context, userID int64) ([]models.Track, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			t.id,
			t.path,
			t.relative_path,
			t.filename,
			t.title,
			t.artist,
			t.album,
			t.format,
			t.size_bytes,
			t.duration_seconds,
			t.modified_at,
			(t.cover_mime_type IS NOT NULL AND t.cover_mime_type <> '' AND t.cover_data IS NOT NULL) AS has_cover
		FROM favorite_tracks ft
		JOIN tracks t ON t.id = ft.track_id
		WHERE ft.user_id = $1
		ORDER BY ft.created_at DESC, t.id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tracks := make([]models.Track, 0)
	for rows.Next() {
		track, err := scanTrack(rows)
		if err != nil {
			return nil, err
		}
		tracks = append(tracks, track)
	}
	return tracks, rows.Err()
}

func (s *Store) ListFavoriteTracksByCategory(ctx context.Context, userID, categoryID int64) ([]models.Track, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			t.id,
			t.path,
			t.relative_path,
			t.filename,
			t.title,
			t.artist,
			t.album,
			t.format,
			t.size_bytes,
			t.duration_seconds,
			t.modified_at,
			(t.cover_mime_type IS NOT NULL AND t.cover_mime_type <> '' AND t.cover_data IS NOT NULL) AS has_cover
		FROM favorite_category_tracks fct
		JOIN tracks t ON t.id = fct.track_id
		WHERE fct.user_id = $1
			AND fct.category_id = $2
		ORDER BY fct.added_at DESC, t.id DESC
	`, userID, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tracks := make([]models.Track, 0)
	for rows.Next() {
		track, err := scanTrack(rows)
		if err != nil {
			return nil, err
		}
		tracks = append(tracks, track)
	}
	return tracks, rows.Err()
}

func (s *Store) ListTrackMemberships(ctx context.Context, userID int64) ([]int64, []models.TrackCategoryMembership, error) {
	favoriteRows, err := s.pool.Query(ctx, `
		SELECT track_id
		FROM favorite_tracks
		WHERE user_id = $1
		ORDER BY track_id
	`, userID)
	if err != nil {
		return nil, nil, err
	}
	defer favoriteRows.Close()

	favoriteTrackIDs := make([]int64, 0)
	for favoriteRows.Next() {
		var trackID int64
		if err := favoriteRows.Scan(&trackID); err != nil {
			return nil, nil, err
		}
		favoriteTrackIDs = append(favoriteTrackIDs, trackID)
	}
	if err := favoriteRows.Err(); err != nil {
		return nil, nil, err
	}

	categoryRows, err := s.pool.Query(ctx, `
		SELECT
			fct.track_id,
			fct.category_id,
			fc.name
		FROM favorite_category_tracks fct
		JOIN favorite_categories fc
			ON fc.id = fct.category_id
			AND fc.user_id = fct.user_id
		WHERE fct.user_id = $1
		ORDER BY fct.track_id, fc.sort_order, fc.id
	`, userID)
	if err != nil {
		return nil, nil, err
	}
	defer categoryRows.Close()

	categoryMemberships := make([]models.TrackCategoryMembership, 0)
	for categoryRows.Next() {
		var membership models.TrackCategoryMembership
		if err := categoryRows.Scan(&membership.TrackID, &membership.CategoryID, &membership.CategoryName); err != nil {
			return nil, nil, err
		}
		categoryMemberships = append(categoryMemberships, membership)
	}
	if err := categoryRows.Err(); err != nil {
		return nil, nil, err
	}

	return favoriteTrackIDs, categoryMemberships, nil
}

func (s *Store) AddFavoriteTrack(ctx context.Context, userID, trackID int64) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO favorite_tracks (user_id, track_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, track_id) DO NOTHING
	`, userID, trackID)
	return err
}

func (s *Store) DeleteFavoriteTrack(ctx context.Context, userID, trackID int64) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM favorite_tracks
		WHERE user_id = $1
			AND track_id = $2
	`, userID, trackID)
	return err
}

func (s *Store) ListFavoriteCategories(ctx context.Context, userID int64) ([]models.FavoriteCategory, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, name, sort_order, created_at, updated_at
		FROM favorite_categories
		WHERE user_id = $1
		ORDER BY sort_order, id
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	categories := make([]models.FavoriteCategory, 0)
	for rows.Next() {
		category, err := scanFavoriteCategory(rows)
		if err != nil {
			return nil, err
		}
		categories = append(categories, category)
	}
	return categories, rows.Err()
}

func (s *Store) CreateFavoriteCategory(ctx context.Context, userID int64, name string) (models.FavoriteCategory, error) {
	var category models.FavoriteCategory
	err := s.pool.QueryRow(ctx, `
		WITH next_order AS (
			SELECT COALESCE(MAX(sort_order), 0) + 10 AS sort_order
			FROM favorite_categories
			WHERE user_id = $1
		)
		INSERT INTO favorite_categories (user_id, name, sort_order, updated_at)
		SELECT $1, $2, sort_order, now()
		FROM next_order
		RETURNING id, user_id, name, sort_order, created_at, updated_at
	`, userID, name).Scan(
		&category.ID,
		&category.UserID,
		&category.Name,
		&category.SortOrder,
		&category.CreatedAt,
		&category.UpdatedAt,
	)
	return category, err
}

func (s *Store) DeleteFavoriteCategory(ctx context.Context, userID, categoryID int64) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM favorite_categories
		WHERE user_id = $1
			AND id = $2
	`, userID, categoryID)
	return err
}

func (s *Store) AddFavoriteTrackToCategory(ctx context.Context, userID, categoryID, trackID int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO favorite_tracks (user_id, track_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, track_id) DO NOTHING
	`, userID, trackID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO favorite_category_tracks (user_id, category_id, track_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, category_id, track_id) DO NOTHING
	`, userID, categoryID, trackID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Store) DeleteFavoriteTrackFromCategory(ctx context.Context, userID, categoryID, trackID int64) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM favorite_category_tracks
		WHERE user_id = $1
			AND category_id = $2
			AND track_id = $3
	`, userID, categoryID, trackID)
	return err
}

func (s *Store) ReplaceTrackLyrics(ctx context.Context, trackID int64, lyrics *models.TrackLyrics) error {
	if lyrics == nil || len(lyrics.Lines) == 0 {
		_, err := s.pool.Exec(ctx, `DELETE FROM track_lyrics WHERE track_id = $1`, trackID)
		return err
	}

	lines, err := json.Marshal(lyrics.Lines)
	if err != nil {
		return fmt.Errorf("marshal lyrics: %w", err)
	}
	source := lyrics.Source
	if source == "" {
		source = "unknown"
	}
	format := lyrics.Format
	if format == "" {
		format = "plain"
	}
	content := lyrics.Content
	if content == "" {
		content = lyricsContent(lyrics.Lines)
	}
	var sourcePath sql.NullString
	if lyrics.SourcePath != nil && *lyrics.SourcePath != "" {
		sourcePath = sql.NullString{String: *lyrics.SourcePath, Valid: true}
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO track_lyrics (
			track_id,
			format,
			content,
			lines,
			source,
			source_path,
			content_hash,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, now())
		ON CONFLICT (track_id)
		DO UPDATE SET
			format = EXCLUDED.format,
			content = EXCLUDED.content,
			lines = EXCLUDED.lines,
			source = EXCLUDED.source,
			source_path = EXCLUDED.source_path,
			content_hash = EXCLUDED.content_hash,
			updated_at = now()
	`,
		trackID,
		format,
		content,
		lines,
		source,
		sourcePath,
		lyricsHash(content, lines),
	)
	return err
}

func (s *Store) GetTrackLyrics(ctx context.Context, trackID int64) (models.TrackLyrics, error) {
	var lyrics models.TrackLyrics
	var format sql.NullString
	var content sql.NullString
	var source sql.NullString
	var sourcePath sql.NullString
	var updatedAt sql.NullTime
	var lines []byte

	err := s.pool.QueryRow(ctx, `
		SELECT
			t.id,
			tl.format,
			tl.content,
			tl.lines,
			tl.source,
			tl.source_path,
			tl.updated_at
		FROM tracks t
		LEFT JOIN track_lyrics tl ON tl.track_id = t.id
		WHERE t.id = $1
	`, trackID).Scan(
		&lyrics.TrackID,
		&format,
		&content,
		&lines,
		&source,
		&sourcePath,
		&updatedAt,
	)
	if err != nil {
		return models.TrackLyrics{}, err
	}
	if format.Valid {
		lyrics.Format = format.String
	} else {
		lyrics.Format = "plain"
	}
	if content.Valid {
		lyrics.Content = content.String
	}
	if source.Valid {
		lyrics.Source = source.String
	}
	if sourcePath.Valid {
		lyrics.SourcePath = &sourcePath.String
	}
	if updatedAt.Valid {
		lyrics.UpdatedAt = &updatedAt.Time
	}
	if len(lines) > 0 {
		if err := json.Unmarshal(lines, &lyrics.Lines); err != nil {
			return models.TrackLyrics{}, fmt.Errorf("decode lyrics: %w", err)
		}
	}
	if lyrics.Lines == nil {
		lyrics.Lines = []models.LyricLine{}
	}
	return lyrics, nil
}

func (s *Store) GetTrackCover(ctx context.Context, trackID int64) (models.TrackCover, error) {
	var cover models.TrackCover
	err := s.pool.QueryRow(ctx, `
		SELECT cover_mime_type, cover_data, cover_hash
		FROM tracks
		WHERE id = $1
			AND cover_mime_type IS NOT NULL
			AND cover_mime_type <> ''
			AND cover_data IS NOT NULL
	`, trackID).Scan(
		&cover.MimeType,
		&cover.Data,
		&cover.Hash,
	)
	if err != nil {
		return models.TrackCover{}, err
	}
	cover.SizeBytes = int64(len(cover.Data))
	return cover, nil
}

func (s *Store) GetTrack(ctx context.Context, id int64) (models.Track, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT
			id,
			path,
			relative_path,
			filename,
			title,
			artist,
			album,
			format,
			size_bytes,
			duration_seconds,
			modified_at,
			(cover_mime_type IS NOT NULL AND cover_mime_type <> '' AND cover_data IS NOT NULL) AS has_cover
		FROM tracks
		WHERE id = $1
	`, id)
	return scanTrack(row)
}

func lyricsHash(content string, lines []byte) string {
	hash := sha256.New()
	hash.Write([]byte(content))
	hash.Write(lines)
	return hex.EncodeToString(hash.Sum(nil))
}

func lyricsContent(lines []models.LyricLine) string {
	text := ""
	for index, line := range lines {
		if index > 0 {
			text += "\n"
		}
		text += line.Text
	}
	return text
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanTrack(row rowScanner) (models.Track, error) {
	var track models.Track
	var duration sql.NullInt64
	var hasCover bool
	err := row.Scan(
		&track.ID,
		&track.Path,
		&track.RelativePath,
		&track.Filename,
		&track.Title,
		&track.Artist,
		&track.Album,
		&track.Format,
		&track.SizeBytes,
		&duration,
		&track.ModifiedAt,
		&hasCover,
	)
	if err != nil {
		return models.Track{}, err
	}
	if duration.Valid {
		value := int(duration.Int64)
		track.DurationSeconds = &value
	}
	track.StreamURL = fmt.Sprintf("/api/tracks/%d/stream", track.ID)
	if hasCover {
		track.CoverURL = fmt.Sprintf("/api/tracks/%d/cover", track.ID)
	}
	return track, nil
}

func scanFavoriteCategory(row rowScanner) (models.FavoriteCategory, error) {
	var category models.FavoriteCategory
	err := row.Scan(
		&category.ID,
		&category.UserID,
		&category.Name,
		&category.SortOrder,
		&category.CreatedAt,
		&category.UpdatedAt,
	)
	return category, err
}
