package database

import (
	"context"
	"database/sql"
	"errors"

	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

var ErrForbidden = errors.New("forbidden")

func (s *Store) ListNoteFolders(ctx context.Context, viewerID int64) ([]models.NoteFolder, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			f.id,
			f.parent_id,
			f.owner_user_id,
			u.nickname,
			f.name,
			f.sort_order,
			COUNT(n.id),
			(f.owner_user_id = $1),
			f.created_at,
			f.updated_at
		FROM note_folders f
		JOIN users u ON u.id = f.owner_user_id
		LEFT JOIN notes n ON n.folder_id = f.id
		GROUP BY f.id, u.nickname
		ORDER BY f.parent_id NULLS FIRST, f.sort_order, lower(f.name), f.id
	`, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	folders := make([]models.NoteFolder, 0)
	for rows.Next() {
		folder, err := scanNoteFolder(rows)
		if err != nil {
			return nil, err
		}
		folders = append(folders, folder)
	}
	return folders, rows.Err()
}

func (s *Store) CreateNoteFolder(ctx context.Context, userID int64, parentID *int64, name string) (models.NoteFolder, error) {
	if parentID != nil {
		if err := s.ensureOwnedFolder(ctx, userID, *parentID); err != nil {
			return models.NoteFolder{}, err
		}
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO note_folders (parent_id, owner_user_id, name, updated_at)
		VALUES ($1, $2, $3, now())
		RETURNING id, parent_id, owner_user_id, '', name, sort_order, 0, true, created_at, updated_at
	`, nullableInt64Ptr(parentID), userID, name)
	folder, err := scanNoteFolder(row)
	if err != nil {
		return models.NoteFolder{}, err
	}
	user, err := s.GetUserByID(ctx, userID)
	if err == nil {
		folder.OwnerNickname = user.Nickname
	}
	return folder, err
}

func (s *Store) UpdateNoteFolder(ctx context.Context, userID, folderID int64, parentID *int64, name string) (models.NoteFolder, error) {
	if err := s.ensureValidFolderMove(ctx, userID, folderID, parentID); err != nil {
		return models.NoteFolder{}, err
	}

	row := s.pool.QueryRow(ctx, `
		UPDATE note_folders f
		SET parent_id = $3, name = $4, updated_at = now()
		FROM users u
		WHERE f.id = $2
			AND f.owner_user_id = $1
			AND u.id = f.owner_user_id
		RETURNING f.id, f.parent_id, f.owner_user_id, u.nickname, f.name, f.sort_order, 0, true, f.created_at, f.updated_at
	`, userID, folderID, nullableInt64Ptr(parentID), name)
	folder, err := scanNoteFolder(row)
	if errors.Is(err, pgx.ErrNoRows) {
		if exists, existsErr := s.noteFolderExists(ctx, folderID); existsErr != nil {
			return models.NoteFolder{}, existsErr
		} else if exists {
			return models.NoteFolder{}, ErrForbidden
		}
	}
	return folder, err
}

func (s *Store) ensureValidFolderMove(ctx context.Context, userID, folderID int64, parentID *int64) error {
	if parentID == nil {
		return nil
	}
	if *parentID == folderID {
		return ErrForbidden
	}
	if err := s.ensureOwnedFolder(ctx, userID, *parentID); err != nil {
		return err
	}

	var descendant bool
	err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE descendants AS (
			SELECT id
			FROM note_folders
			WHERE parent_id = $1
			UNION ALL
			SELECT child.id
			FROM note_folders child
			JOIN descendants parent ON child.parent_id = parent.id
		)
		SELECT EXISTS(SELECT 1 FROM descendants WHERE id = $2)
	`, folderID, *parentID).Scan(&descendant)
	if err != nil {
		return err
	}
	if descendant {
		return ErrForbidden
	}
	return nil
}

func (s *Store) DeleteNoteFolder(ctx context.Context, userID, folderID int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM note_folders WHERE id = $1 AND owner_user_id = $2`, folderID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	if exists, err := s.noteFolderExists(ctx, folderID); err != nil {
		return err
	} else if exists {
		return ErrForbidden
	}
	return pgx.ErrNoRows
}

func (s *Store) ListNotes(ctx context.Context, viewerID int64, folderID *int64, unfiled bool, query string) ([]models.Note, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			n.id,
			n.folder_id,
			n.owner_user_id,
			u.nickname,
			n.title,
			n.content,
			(n.owner_user_id = $1),
			n.created_at,
			n.updated_at
		FROM notes n
		JOIN users u ON u.id = n.owner_user_id
		WHERE ($2::bigint IS NULL OR n.folder_id = $2)
			AND ($3::boolean = false OR n.folder_id IS NULL)
			AND (
				$4 = ''
				OR lower(n.title) LIKE '%' || lower($4) || '%'
				OR lower(n.content) LIKE '%' || lower($4) || '%'
				OR lower(u.nickname) LIKE '%' || lower($4) || '%'
			)
		ORDER BY n.updated_at DESC, n.id DESC
	`, viewerID, nullableInt64Ptr(folderID), unfiled, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notes := make([]models.Note, 0)
	for rows.Next() {
		note, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		notes = append(notes, note)
	}
	return notes, rows.Err()
}

func (s *Store) GetNote(ctx context.Context, viewerID, noteID int64) (models.Note, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT
			n.id,
			n.folder_id,
			n.owner_user_id,
			u.nickname,
			n.title,
			n.content,
			(n.owner_user_id = $1),
			n.created_at,
			n.updated_at
		FROM notes n
		JOIN users u ON u.id = n.owner_user_id
		WHERE n.id = $2
	`, viewerID, noteID)
	return scanNote(row)
}

func (s *Store) CreateNote(ctx context.Context, userID int64, folderID *int64, title, content string) (models.Note, error) {
	if folderID != nil {
		if err := s.ensureOwnedFolder(ctx, userID, *folderID); err != nil {
			return models.Note{}, err
		}
	}

	row := s.pool.QueryRow(ctx, `
		INSERT INTO notes (folder_id, owner_user_id, title, content, updated_at)
		VALUES ($1, $2, $3, $4, now())
		RETURNING id, folder_id, owner_user_id, '', title, content, true, created_at, updated_at
	`, nullableInt64Ptr(folderID), userID, title, content)
	note, err := scanNote(row)
	if err != nil {
		return models.Note{}, err
	}
	user, err := s.GetUserByID(ctx, userID)
	if err == nil {
		note.OwnerNickname = user.Nickname
	}
	return note, err
}

func (s *Store) UpdateNote(ctx context.Context, userID, noteID int64, folderID *int64, title, content string) (models.Note, error) {
	if folderID != nil {
		if err := s.ensureOwnedFolder(ctx, userID, *folderID); err != nil {
			return models.Note{}, err
		}
	}

	row := s.pool.QueryRow(ctx, `
		UPDATE notes n
		SET folder_id = $3, title = $4, content = $5, updated_at = now()
		FROM users u
		WHERE n.id = $2
			AND n.owner_user_id = $1
			AND u.id = n.owner_user_id
		RETURNING n.id, n.folder_id, n.owner_user_id, u.nickname, n.title, n.content, true, n.created_at, n.updated_at
	`, userID, noteID, nullableInt64Ptr(folderID), title, content)
	note, err := scanNote(row)
	if errors.Is(err, pgx.ErrNoRows) {
		if exists, existsErr := s.noteExists(ctx, noteID); existsErr != nil {
			return models.Note{}, existsErr
		} else if exists {
			return models.Note{}, ErrForbidden
		}
	}
	return note, err
}

func (s *Store) DeleteNote(ctx context.Context, userID, noteID int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM notes WHERE id = $1 AND owner_user_id = $2`, noteID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	if exists, err := s.noteExists(ctx, noteID); err != nil {
		return err
	} else if exists {
		return ErrForbidden
	}
	return pgx.ErrNoRows
}

func (s *Store) ensureOwnedFolder(ctx context.Context, userID, folderID int64) error {
	var ownerID int64
	err := s.pool.QueryRow(ctx, `SELECT owner_user_id FROM note_folders WHERE id = $1`, folderID).Scan(&ownerID)
	if err != nil {
		return err
	}
	if ownerID != userID {
		return ErrForbidden
	}
	return nil
}

func (s *Store) noteFolderExists(ctx context.Context, folderID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM note_folders WHERE id = $1)`, folderID).Scan(&exists)
	return exists, err
}

func (s *Store) noteExists(ctx context.Context, noteID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM notes WHERE id = $1)`, noteID).Scan(&exists)
	return exists, err
}

func nullableInt64Ptr(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func scanNoteFolder(row rowScanner) (models.NoteFolder, error) {
	var folder models.NoteFolder
	var parentID sql.NullInt64
	var count int64
	err := row.Scan(
		&folder.ID,
		&parentID,
		&folder.OwnerUserID,
		&folder.OwnerNickname,
		&folder.Name,
		&folder.SortOrder,
		&count,
		&folder.CanEdit,
		&folder.CreatedAt,
		&folder.UpdatedAt,
	)
	if err != nil {
		return models.NoteFolder{}, err
	}
	if parentID.Valid {
		value := parentID.Int64
		folder.ParentID = &value
	}
	folder.NoteCount = int(count)
	return folder, nil
}

func scanNote(row rowScanner) (models.Note, error) {
	var note models.Note
	var folderID sql.NullInt64
	err := row.Scan(
		&note.ID,
		&folderID,
		&note.OwnerUserID,
		&note.OwnerNickname,
		&note.Title,
		&note.Content,
		&note.CanEdit,
		&note.CreatedAt,
		&note.UpdatedAt,
	)
	if err != nil {
		return models.Note{}, err
	}
	if folderID.Valid {
		value := folderID.Int64
		note.FolderID = &value
	}
	return note, nil
}
