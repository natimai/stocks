import os
from typing import Optional

import firebase_admin
from firebase_admin import credentials, firestore

from .config import settings
from .logger import log_event

_db = None


def init_firebase() -> Optional[firestore.Client]:
    global _db

    if _db is not None:
        return _db

    credentials_file = settings.firebase_credentials_file
    try:
        try:
            firebase_admin.get_app()
        except ValueError:
            if credentials_file and os.path.exists(credentials_file):
                cred = credentials.Certificate(credentials_file)
                firebase_admin.initialize_app(cred)
            else:
                firebase_admin.initialize_app()

        _db = firestore.client()
        log_event("info", "firebase.initialized", credentialsFile=credentials_file)
    except Exception as exc:
        _db = None
        log_event("warning", "firebase.init_failed", errorType=type(exc).__name__, errorMessage=str(exc))
    return _db


def get_db() -> Optional[firestore.Client]:
    return init_firebase()
