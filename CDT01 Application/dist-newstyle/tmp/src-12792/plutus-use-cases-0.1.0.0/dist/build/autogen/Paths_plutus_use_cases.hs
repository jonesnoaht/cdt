{-# LANGUAGE CPP #-}
{-# LANGUAGE NoRebindableSyntax #-}
{-# OPTIONS_GHC -fno-warn-missing-import-lists #-}
{-# OPTIONS_GHC -Wno-missing-safe-haskell-mode #-}
module Paths_plutus_use_cases (
    version,
    getBinDir, getLibDir, getDynLibDir, getDataDir, getLibexecDir,
    getDataFileName, getSysconfDir
  ) where

import qualified Control.Exception as Exception
import Data.Version (Version(..))
import System.Environment (getEnv)
import Prelude

#if defined(VERSION_base)

#if MIN_VERSION_base(4,0,0)
catchIO :: IO a -> (Exception.IOException -> IO a) -> IO a
#else
catchIO :: IO a -> (Exception.Exception -> IO a) -> IO a
#endif

#else
catchIO :: IO a -> (Exception.IOException -> IO a) -> IO a
#endif
catchIO = Exception.catch

version :: Version
version = Version [0,1,0,0] []
bindir, libdir, dynlibdir, datadir, libexecdir, sysconfdir :: FilePath

bindir     = "/Users/noahjones/.cabal/store/ghc-8.10.4/plts-s-css-0.1.0.0-f82ee11e/bin"
libdir     = "/Users/noahjones/.cabal/store/ghc-8.10.4/plts-s-css-0.1.0.0-f82ee11e/lib"
dynlibdir  = "/Users/noahjones/.cabal/store/ghc-8.10.4/lib"
datadir    = "/Users/noahjones/.cabal/store/ghc-8.10.4/plts-s-css-0.1.0.0-f82ee11e/share"
libexecdir = "/Users/noahjones/.cabal/store/ghc-8.10.4/plts-s-css-0.1.0.0-f82ee11e/libexec"
sysconfdir = "/Users/noahjones/.cabal/store/ghc-8.10.4/plts-s-css-0.1.0.0-f82ee11e/etc"

getBinDir, getLibDir, getDynLibDir, getDataDir, getLibexecDir, getSysconfDir :: IO FilePath
getBinDir = catchIO (getEnv "plutus_use_cases_bindir") (\_ -> return bindir)
getLibDir = catchIO (getEnv "plutus_use_cases_libdir") (\_ -> return libdir)
getDynLibDir = catchIO (getEnv "plutus_use_cases_dynlibdir") (\_ -> return dynlibdir)
getDataDir = catchIO (getEnv "plutus_use_cases_datadir") (\_ -> return datadir)
getLibexecDir = catchIO (getEnv "plutus_use_cases_libexecdir") (\_ -> return libexecdir)
getSysconfDir = catchIO (getEnv "plutus_use_cases_sysconfdir") (\_ -> return sysconfdir)

getDataFileName :: FilePath -> IO FilePath
getDataFileName name = do
  dir <- getDataDir
  return (dir ++ "/" ++ name)
