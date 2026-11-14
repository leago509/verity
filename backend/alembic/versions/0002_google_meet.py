"""google meet integration

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-12 13:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('meetings', sa.Column('source', sa.String(length=16), nullable=False, server_default='upload'))
    op.add_column('meetings', sa.Column('meeting_date', sa.DateTime(timezone=True), nullable=True))
    op.add_column('meetings', sa.Column('external_id', sa.String(length=255), nullable=True))
    op.create_unique_constraint('uq_meetings_external_id', 'meetings', ['external_id'])

    op.create_table('google_connections',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('google_email', sa.String(length=255), nullable=False),
    sa.Column('refresh_token_enc', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('subscription_name', sa.String(length=255), nullable=True),
    sa.Column('subscription_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_google_connections_user_id'), 'google_connections', ['user_id'], unique=True)

    op.create_table('recording_ingestions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('meeting_id', sa.Integer(), nullable=True),
    sa.Column('recording_name', sa.String(length=255), nullable=False),
    sa.Column('drive_file_id', sa.String(length=255), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('recording_name')
    )
    op.create_index(op.f('ix_recording_ingestions_user_id'), 'recording_ingestions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_recording_ingestions_user_id'), table_name='recording_ingestions')
    op.drop_table('recording_ingestions')
    op.drop_index(op.f('ix_google_connections_user_id'), table_name='google_connections')
    op.drop_table('google_connections')
    op.drop_constraint('uq_meetings_external_id', 'meetings', type_='unique')
    op.drop_column('meetings', 'external_id')
    op.drop_column('meetings', 'meeting_date')
    op.drop_column('meetings', 'source')
